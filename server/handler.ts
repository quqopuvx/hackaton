import type { IncomingMessage, ServerResponse } from "node:http";
import { DatabaseError } from "pg";
import { randomUUID } from "node:crypto";
import { authorizeSchoolMail, sendSchoolMail } from "./school-mail.ts";
import { applicantMailSetupError, getApplicantMailSettings, handleApplicantUnsubscribe, saveApplicantMailSettings, sendApplicantMail } from "./applicant-mail.ts";
import { applicantMailDelays, type ApplicantMailSettings } from "../lib/olympiad.ts";
import { readSchoolReplies } from "./school-replies.ts";
import { isSchoolMailLayout, isSingleEmail, schoolMailDefaultLayout, schoolMailDraft, schoolMailLimit, schoolMailSubjectLimit, schoolMailTemplates, schoolMailTextLimit, type SchoolMailLayout, type SchoolMailRecipient, type SchoolMailTemplate } from "../lib/school-mail.ts";
import { refreshInstitution, runAgent } from "../lib/ai/agent.ts";
import { institutionTypeLabels, type InstitutionType } from "../lib/institution-types.ts";
import { createCampaign, deleteCampaign, deleteSchoolMailTemplate, findCampaign, findInstitution, findSchoolMailTemplate, hasSchoolMailRequest, listCampaigns, listInstitutions, listOlympiadSchools, listSchoolMailHistory, listSchoolMailReminders, listSchoolMailTemplates, normalize, readCampaignView, saveCampaignTurn, saveSchoolMailTemplate, updateCampaignDetails, updateInstitution } from "../lib/store.ts";
import { campaignMessageLimit } from "../lib/campaigns.ts";
import { planCampaignTurn, recordCampaignExchange } from "./campaign-agent.ts";
import { addCampaignSchool } from "./campaign-schools.ts";
import type { InstitutionEdits, SearchEvent } from "../lib/types.ts";
import type { Account } from "../lib/accounts.ts";
import { isSchoolMailDesign, mailDesignRequestLimit, mailDesignText, type SchoolMailDesign } from "../lib/school-mail-design.ts";
import { allowsRequestOrigin, readAudit, readSession, recordAudit, setSessionCookie, signIn, signOut } from "./accounts.ts";

import { allowsOlympiadAgent, listOlympiadInvitationContacts, listSchoolApplicants, parseOlympiadRegistration, saveOlympiadRegistration } from "./olympiad.ts";

class InputError extends Error {}

async function readBody(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new InputError("Слишком большой запрос.");
    chunks.push(buffer);
  }

  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InputError("Ожидается корректный JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new InputError("Ожидается JSON-объект.");
  }
  return body as Record<string, unknown>;
}

async function readQuery(req: IncomingMessage): Promise<string> {
  const { query } = await readBody(req, 4096);
  if (typeof query !== "string" || query.trim().length > 400 || !normalize(query)) {
    throw new InputError("Укажите запрос длиной до 400 символов.");
  }
  return query.trim();
}

const requiredFields = { name: "Название", city: "Город", region: "Регион" } as const;
const optionalFields = {
  leaderName: "Руководитель",
  institutionEmail: "Почта",
  institutionPhone: "Телефон",
} as const;

function isSourceUrl(value: string): boolean {
  return URL.canParse(value) && ["http:", "https:"].includes(new URL(value).protocol);
}

async function readInstitutionEdits(req: IncomingMessage): Promise<InstitutionEdits> {
  const body = await readBody(req, 64 * 1024);
  const edits: InstitutionEdits = {};

  for (const key of Object.keys(requiredFields) as (keyof typeof requiredFields)[]) {
    if (!Object.hasOwn(body, key)) continue;
    const value = body[key];
    if (typeof value !== "string" || !value.trim() || value.trim().length > 500 ||
        value.includes("\0") || !normalize(value)) {
      throw new InputError(`Поле «${requiredFields[key]}» должно содержать от 1 до 500 символов.`);
    }
    edits[key] = value.trim();
  }

  for (const key of Object.keys(optionalFields) as (keyof typeof optionalFields)[]) {
    if (!Object.hasOwn(body, key)) continue;
    const value = body[key];
    if (value !== null && (typeof value !== "string" || value.trim().length > 500 || value.includes("\0"))) {
      throw new InputError(`Поле «${optionalFields[key]}» должно содержать не более 500 символов.`);
    }
    edits[key] = value?.trim() || null;
  }

  if (Object.hasOwn(body, "institutionType")) {
    const value = body.institutionType;
    if (value !== null && (typeof value !== "string" || !Object.hasOwn(institutionTypeLabels, value))) {
      throw new InputError("Выберите тип учреждения из списка.");
    }
    edits.institutionType = value as InstitutionType | null;
  }

  if (Object.hasOwn(body, "sourceUrls")) {
    const value = body.sourceUrls;
    if (!Array.isArray(value) || value.some((url: unknown) =>
      typeof url !== "string" || url.includes("\0") || !isSourceUrl(url.trim()))) {
      throw new InputError("Укажите полные ссылки на источники, начинающиеся с http:// или https://.");
    }
    edits.sourceUrls = [...new Set(value.map((url: string) => url.trim()))];
  }

  if (!Object.keys(edits).length || Object.keys(body).some((key) => !Object.hasOwn(edits, key))) {
    throw new InputError("Укажите поля учреждения для изменения.");
  }
  return edits;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function handleAuth(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (pathname === "/api/auth/session" && req.method === "GET") {
    const user = await readSession(req);
    send(res, 200, { user });
    return;
  }
  if ((pathname !== "/api/auth/login" && pathname !== "/api/auth/logout") || req.method !== "POST") {
    send(res, 405, { error: "Метод не поддерживается." });
    return;
  }
  if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new InputError("Ожидается application/json.");
  }
  if (pathname === "/api/auth/logout") {
    await signOut(req);
    setSessionCookie(req, res);
    send(res, 200, {});
    return;
  }
  const { username, password } = await readBody(req, 4096);
  if (typeof username !== "string" || !/^[a-z0-9._-]{1,48}$/i.test(username.trim()) ||
      typeof password !== "string" || password.length === 0 || password.length > 256) {
    throw new InputError("Укажите логин и пароль.");
  }
  const result = await signIn(req, username.trim().toLowerCase(), password);
  if (result === "denied") send(res, 401, { error: "Неверный логин или пароль." });
  else if (result === "throttled") send(res, 429, { error: "Слишком много попыток. Повторите вход через несколько минут." });
  else {
    setSessionCookie(req, res, result.token);
    send(res, 200, { user: result.user });
  }
}

const uuidPattern = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

function isMailLine(value: unknown, limit: number): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= limit && !/[\r\n\0]/.test(value);
}

function isMailText(value: unknown): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= schoolMailTextLimit && !value.includes("\0");
}

function readMailDesign(value: unknown): SchoolMailDesign | null | undefined {
  if (value === null || value === undefined) return value;
  if (!isSchoolMailDesign(value)) throw new InputError("Проверьте оформление и изображения в конструкторе.");
  return value;
}

function checkDesignText(design: SchoolMailDesign | null | undefined, text: string, signature?: string): void {
  if (design && mailDesignText(design, text, signature).length > schoolMailTextLimit) {
    throw new InputError(`Общий текст письма должен содержать не более ${schoolMailTextLimit} символов.`);
  }
}

async function handleMailTemplates(req: IncomingMessage, res: ServerResponse, user: Account, templateId?: string): Promise<void> {
  if (req.method === "DELETE" && templateId) {
    if (!(await deleteSchoolMailTemplate(templateId))) {
      send(res, 404, { error: "Шаблон не найден." });
      return;
    }
    await recordAudit(user, "template_delete", templateId);
    send(res, 200, { deleted: true });
    return;
  }
  if (req.method === "GET") {
    if (templateId) {
      const template = await findSchoolMailTemplate(templateId);
      if (template) send(res, 200, { template });
      else send(res, 404, { error: "Шаблон не найден." });
    } else send(res, 200, { templates: await listSchoolMailTemplates() });
    return;
  }
  if (req.method !== "POST" || templateId) {
    send(res, 405, { error: "Метод не поддерживается." });
    return;
  }
  if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new InputError("Ожидается application/json.");
  }
  const { id, name, subject, text, layout, design: rawDesign } = await readBody(req, mailDesignRequestLimit);
  if (id !== undefined && (typeof id !== "string" || !uuidPattern.test(id))) throw new InputError("Некорректный шаблон.");
  if (!isMailLine(name, 100) || !isMailLine(subject, schoolMailSubjectLimit) || !isMailText(text)) {
    throw new InputError("Заполните название, тему и текст шаблона.");
  }
  if (layout !== undefined && !isSchoolMailLayout(layout)) throw new InputError("Выберите оформление письма.");
  const design = readMailDesign(rawDesign);
  checkDesignText(design, text);
  const template = await saveSchoolMailTemplate({
    id: id ?? randomUUID(), name: name.trim(), subject: subject.trim(), text: text.trim(), layout, design,
  }, id !== undefined);
  if (!template) {
    send(res, 404, { error: "Шаблон не найден." });
    return;
  }
  await recordAudit(user, id === undefined ? "template_create" : "template_edit", template.id);
  send(res, id === undefined ? 201 : 200, { template });
}

async function handleSchoolMail(req: IncomingMessage, res: ServerResponse, user: Account, replies = false): Promise<void> {
  if (req.method !== "POST") {
    send(res, 405, { error: "Метод не поддерживается." });
    return;
  }
  if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new InputError("Ожидается application/json.");
  }
  if (replies) {
    send(res, 200, { replies: await readSchoolReplies() });
    return;
  }
  const { requestId, template, recipients, accessCode, text, subject, layout, campaignId, replyTo, design: rawDesign, signature } =
    await readBody(req, mailDesignRequestLimit);
  const access = authorizeSchoolMail(typeof accessCode === "string" ? accessCode : "");
  if (access === "unconfigured") {
    send(res, 503, { error: "Почта ещё не настроена. Обратитесь к администратору." });
    return;
  }
  if (access === "denied") {
    send(res, 403, { error: "Проверьте код доступа к почте." });
    return;
  }
  if (text !== undefined && !isMailText(text)) {
    throw new InputError(`Текст письма должен содержать от 1 до ${schoolMailTextLimit} символов.`);
  }
  if (typeof requestId !== "string" || !uuidPattern.test(requestId) ||
      typeof template !== "string" || (!Object.hasOwn(schoolMailTemplates, template) && !uuidPattern.test(template)) ||
      !Array.isArray(recipients) || recipients.length === 0 || recipients.length > schoolMailLimit) {
    throw new InputError(`Выберите шаблон и от 1 до ${schoolMailLimit} получателей.`);
  }
  const selected = new Map<string, SchoolMailRecipient>();
  for (const recipient of recipients) {
    const { id, email } = recipient ?? {};
    if (typeof id !== "string" || !/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n ||
        typeof email !== "string" || !isSingleEmail(email) || selected.has(id)) {
      throw new InputError("Проверьте список получателей и их почтовые адреса.");
    }
    selected.set(id, { id, email });
  }
  let campaign: string | null = null;
  if (campaignId !== undefined) {
    if (typeof campaignId !== "string" || !uuidPattern.test(campaignId)) throw new InputError("Некорректная кампания.");
    const current = await findCampaign(campaignId);
    if (!current) throw new InputError("Кампания не найдена.");
    const allowed = new Set(current.state.schoolIds);
    if ([...selected.keys()].some((id) => !allowed.has(id))) {
      throw new InputError("Подборка кампании изменилась. Откройте предпросмотр заново.");
    }
    campaign = current.id;
  }
  if (layout !== undefined && !isSchoolMailLayout(layout)) throw new InputError("Выберите оформление письма.");
  if (subject !== undefined && !isMailLine(subject, schoolMailSubjectLimit)) throw new InputError("Некорректная тема письма.");
  if (replyTo !== undefined && (typeof replyTo !== "string" || !isSingleEmail(replyTo))) {
    throw new InputError("Укажите один действительный адрес для ответов.");
  }
  const design = readMailDesign(rawDesign);
  if (signature !== undefined && (typeof signature !== "string" || signature.length > schoolMailTextLimit || signature.includes("\0"))) {
    throw new InputError("Проверьте подпись письма.");
  }
  let message: { subject: string; text: string; layout: SchoolMailLayout; replyTo?: string; design?: SchoolMailDesign | null; signature?: string };
  if (Object.hasOwn(schoolMailTemplates, template)) {
    const builtin = template as SchoolMailTemplate;
    message = { subject: subject?.trim() ?? schoolMailTemplates[builtin], text: text ?? schoolMailDraft(builtin),
      layout: layout ?? schoolMailDefaultLayout(builtin) };
  } else {
    const saved = await findSchoolMailTemplate(template);
    if (saved) {
      message = { subject: subject?.trim() ?? saved.subject, text: text ?? saved.text,
        layout: layout ?? saved.layout, design: design === undefined ? saved.design : design, signature };
    } else {
      // A retry can use its original payload after the saved template was deleted.
      if (typeof subject !== "string" || typeof text !== "string" || layout === undefined ||
          design === undefined || !(await hasSchoolMailRequest(requestId, template))) {
        throw new InputError("Выбранный шаблон не найден.");
      }
      message = { subject: subject.trim(), text, layout, design, signature };
    }
  }
  checkDesignText(message.design, message.text, message.signature);
  message.replyTo = replyTo;
  const outcomes = await sendSchoolMail(requestId, template, [...selected.values()], message, campaign);
  await recordAudit(user, "mail_send", "Получателей: " + selected.size + ". Запрос: " + requestId);
  send(res, 200, { outcomes });
}

async function handleCampaign(req: IncomingMessage, res: ServerResponse, user: Account, id?: string): Promise<void> {
  const method = req.method;
  if (method === "GET" && !id) {
    send(res, 200, { campaigns: await listCampaigns() });
    return;
  }
  if (method !== "GET" && method !== "POST" && !((method === "PATCH" || method === "DELETE") && id)) {
    send(res, 405, { error: "Метод не поддерживается." });
    return;
  }
  const current = id ? await findCampaign(id) : undefined;
  if (id && !current) {
    send(res, 404, { error: "Кампания не найдена." });
    return;
  }
  if (method === "GET" && current) {
    send(res, 200, await readCampaignView(current));
    return;
  }
  if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new InputError("Ожидается application/json.");
  }
  const { title, schedule, registrationUrl, version, message, schoolId } = await readBody(req, 16 * 1024);
  if (!current) {
    if (!isMailLine(title, 120)) throw new InputError("Введите название кампании длиной до 120 символов.");
    const campaign = await createCampaign(randomUUID(), title.trim());
    await recordAudit(user, "campaign_create", campaign.id);
    send(res, 201, await readCampaignView(campaign));
    return;
  }
  if (version !== current.version) {
    send(res, 409, { error: "Кампания изменилась. Обновите её и повторите действие." });
    return;
  }
  if (method === "DELETE") {
    if (await deleteCampaign(current.id, current.version)) {
      await recordAudit(user, "campaign_delete", current.id);
      send(res, 200, { deleted: true });
    }
    else send(res, 409, { error: "Кампания изменилась. Обновите её и повторите действие." });
    return;
  }
  let next;
  if (method === "PATCH") {
    if (!isMailLine(title, 120) || !(schedule === "" || isMailLine(schedule, 160)) ||
        typeof registrationUrl !== "string" || registrationUrl.length > 1000 ||
        /[\s\0]/.test(registrationUrl) || (registrationUrl !== "" && !isSourceUrl(registrationUrl))) {
      throw new InputError("Проверьте название, дату и ссылку на регистрацию (http:// или https://).");
    }
    next = await updateCampaignDetails(current.id, current.version, { title: title.trim(), schedule: schedule.trim(), registrationUrl });
  } else if (schoolId !== undefined) {
    if (typeof schoolId !== "string" || !current.state.schoolChoiceIds?.includes(schoolId)) {
      throw new InputError("Выберите школу из последнего уточнения в чате.");
    }
    const school = await findInstitution(schoolId);
    if (school?.institutionType !== "school") throw new InputError("Карточка школы изменилась. Повторите запрос в чате.");
    const state = { ...current.state };
    const reply = addCampaignSchool(state, school);
    next = await saveCampaignTurn(current.id, current.version,
      recordCampaignExchange(state, `Выбираю «${school.name}» (${school.city}).`, reply));
  } else {
    if (typeof message !== "string" || !message.trim() || message.length > campaignMessageLimit || message.includes("\0")) {
      throw new InputError(`Введите сообщение длиной до ${campaignMessageLimit} символов.`);
    }
    next = await saveCampaignTurn(current.id, current.version, await planCampaignTurn(current, message.trim()));
  }
  if (next) {
    await recordAudit(user, method === "PATCH" ? "campaign_edit" : schoolId !== undefined ? "campaign_school" : "campaign_message", next.id);
    send(res, 200, await readCampaignView(next));
  }
  else send(res, 409, { error: "Кампания изменилась. Обновите её и повторите действие." });
}

async function streamSearch(query: string, res: ServerResponse, user: Account): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const emit = (event: SearchEvent) => {
    if (!res.destroyed) res.write(JSON.stringify(event) + "\n");
  };
  const heartbeat = setInterval(() => {
    if (!res.destroyed) res.write("\n");
  }, 15_000);
  try {
    const result = await runAgent(query, (institution, checkingContacts) =>
      emit({ type: "institution", institution, checkingContacts }));
    await recordAudit(user, "search", "Найдено: " + result.institutions.length);
    emit({ type: "complete", result });
  } catch (error) {
    const databaseError = error instanceof DatabaseError;
    if (databaseError) console.error(error);
    emit({
      type: "error",
      message: databaseError ? "Не удалось прочитать или сохранить данные в PostgreSQL."
        : error instanceof Error ? error.message : "Ошибка сервера.",
    });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}

async function handleOlympiadRegistration(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    send(res, 405, { error: "Метод не поддерживается." });
    return;
  }
  if (req.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    send(res, 415, { error: "Ожидается запрос в формате JSON." });
    return;
  }
  const registration = parseOlympiadRegistration(await readBody(req, 4096));
  if (registration.error) throw new InputError(registration.error);
  const school = await findInstitution(registration.schoolId);
  if (school?.institutionType !== "school") throw new InputError("Выберите действующую школу из реестра.");
  try {
    saveOlympiadRegistration(registration);
  } catch {
    send(res, 503, { error: "Не удалось сохранить регистрацию. Попробуй ещё раз." });
    return;
  }
  send(res, 200, { registered: true });
}

function handleOlympiadContacts(req: IncomingMessage, res: ServerResponse, url: URL): void {
  if (!allowsOlympiadAgent(req.headers.authorization)) {
    res.setHeader("WWW-Authenticate", "Bearer");
    send(res, 401, { error: "Требуется токен агента." });
    return;
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    send(res, 405, { error: "Метод не поддерживается." });
    return;
  }
  const after = url.searchParams.get("after") ?? "0";
  if (!/^\d{1,19}$/.test(after) || BigInt(after) > 9223372036854775807n) {
    throw new InputError("Некорректный курсор.");
  }
  try {
    send(res, 200, listOlympiadInvitationContacts(after));
  } catch {
    send(res, 503, { error: "Не удалось прочитать контакты олимпиады." });
  }
}

function applicantMailAuthorized(res: ServerResponse, accessCode: unknown): boolean {
  const setupError = applicantMailSetupError();
  if (setupError) {
    send(res, 503, { error: setupError });
    return false;
  }
  if (authorizeSchoolMail(typeof accessCode === "string" ? accessCode : "") !== "allowed") {
    send(res, 403, { error: "Неверный код отправки писем." });
    return false;
  }
  return true;
}

async function handleApplicantMail(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    send(res, 405, { error: "Метод не поддерживается." });
    return;
  }
  const { requestId, applicantId, subject, text, accessCode } = await readBody(req, 16 * 1024);
  if (typeof requestId !== "string" || !uuidPattern.test(requestId) || typeof applicantId !== "string" ||
      !/^[1-9][0-9]{0,18}$/.test(applicantId) || BigInt(applicantId) > 9223372036854775807n) {
    throw new InputError("Выберите абитуриента из реестра.");
  }
  if (!isMailLine(subject, schoolMailSubjectLimit) || !isMailText(text)) throw new InputError("Проверьте тему и текст письма.");
  if (!applicantMailAuthorized(res, accessCode)) return;
  send(res, 200, { status: await sendApplicantMail(requestId.toLowerCase(), applicantId, { subject: subject.trim(), text: text.trim() }) });
}

async function handleApplicantMailSettings(req: IncomingMessage, res: ServerResponse, user: Account): Promise<void> {
  if (req.method === "GET") {
    send(res, 200, { settings: getApplicantMailSettings(), setupError: applicantMailSetupError() });
    return;
  }
  if (req.method !== "PUT") {
    res.setHeader("Allow", "GET, PUT");
    send(res, 405, { error: "Метод не поддерживается." });
    return;
  }
  if (user.role !== "admin") {
    send(res, 403, { error: "Автоматическую рассылку настраивает администратор." });
    return;
  }
  const { enabled, delayDays, subject, text, accessCode } = await readBody(req, 16 * 1024);
  const delay = applicantMailDelays.find((allowed) => allowed === delayDays);
  if (typeof enabled !== "boolean" || !delay || typeof subject !== "string" || typeof text !== "string" ||
      ((enabled || subject !== "") && !isMailLine(subject, schoolMailSubjectLimit)) ||
      ((enabled || text !== "") && !isMailText(text))) {
    throw new InputError("Проверьте срок, тему и текст автоматического письма.");
  }
  if (enabled && !applicantMailAuthorized(res, accessCode)) return;
  const settings: ApplicantMailSettings = { enabled, delayDays: delay, subject: subject.trim(), text: text.trim() };
  saveApplicantMailSettings(settings);
  send(res, 200, { settings, setupError: applicantMailSetupError() });
}

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const { pathname } = url;
  if (!pathname.startsWith("/api/")) return false;
  if (handleApplicantUnsubscribe(req, res, pathname)) return true;
  const institutionRoute = /^\/api\/institutions\/([1-9][0-9]{0,18})$/.exec(pathname);
  const applicantsRoute = /^\/api\/institutions\/([1-9][0-9]{0,18})\/applicants$/.exec(pathname);
  const refreshRoute = /^\/api\/institutions\/([1-9][0-9]{0,18})\/refresh$/.exec(pathname);
  const campaignRoute = /^\/api\/campaigns\/([^/]+)$/.exec(pathname);
  const templateRoute = /^\/api\/school-mail\/templates\/([^/]+)$/.exec(pathname);

  try {
    if (!allowsRequestOrigin(req)) {
      send(res, 403, { error: "Откройте приложение и повторите действие." });
      return true;
    }
    if (pathname === "/api/olympiad/registrations") {
      await handleOlympiadRegistration(req, res);
      return true;
    }
    if (pathname === "/api/olympiad/schools") {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        send(res, 405, { error: "Метод не поддерживается." });
      } else {
        send(res, 200, { schools: await listOlympiadSchools() });
      }
      return true;
    }
    if (pathname === "/api/olympiad/invitation-contacts") {
      handleOlympiadContacts(req, res, url);
      return true;
    }
    if (pathname.startsWith("/api/auth/")) {
      await handleAuth(req, res, pathname);
      return true;
    }
    const user = await readSession(req);
    if (!user) {
      send(res, 401, { error: "Войдите в аккаунт." });
      return true;
    }
    if (applicantsRoute) {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        send(res, 405, { error: "Метод не поддерживается." });
      } else {
        try {
          send(res, 200, { applicants: listSchoolApplicants(applicantsRoute[1]), mailSetupError: applicantMailSetupError() });
        } catch {
          send(res, 503, { error: "Не удалось загрузить список абитуриентов." });
        }
      }
      return true;
    }
    if (pathname === "/api/olympiad/applicant-mail" || pathname === "/api/olympiad/applicant-mail/settings") {
      if (pathname.endsWith("/settings")) await handleApplicantMailSettings(req, res, user);
      else await handleApplicantMail(req, res);
      return true;
    }
    if (pathname === "/api/audit") {
      if (user.role !== "admin") send(res, 403, { error: "Журнал доступен администратору." });
      else if (req.method !== "GET") send(res, 405, { error: "Метод не поддерживается." });
      else send(res, 200, { events: await readAudit() });
      return true;
    }
    if (pathname === "/api/campaigns" || (campaignRoute && uuidPattern.test(campaignRoute[1]))) {
      await handleCampaign(req, res, user, campaignRoute?.[1]);
    } else if (pathname === "/api/school-mail/templates" || (templateRoute && uuidPattern.test(templateRoute[1]))) {
      await handleMailTemplates(req, res, user, templateRoute?.[1]);
    } else if (pathname === "/api/school-mail/history" || pathname === "/api/school-mail/reminders") {
      if (req.method !== "GET") send(res, 405, { error: "Метод не поддерживается." });
      else if (pathname.endsWith("/history")) {
        const page = Number(url.searchParams.get("page") ?? "1");
        if (!Number.isInteger(page) || page < 1 || page > 10_000) throw new InputError("Некорректный номер страницы.");
        send(res, 200, await listSchoolMailHistory(page));
      } else {
        const days = Number(url.searchParams.get("days") ?? "7");
        if (![7, 14, 30].includes(days)) throw new InputError("Выберите срок 7, 14 или 30 дней.");
        const includeReplied = url.searchParams.get("includeReplied") === "true";
        let schools = await listSchoolMailReminders(days, includeReplied);
        if (schools.length && !includeReplied) {
          await readSchoolReplies();
          schools = await listSchoolMailReminders(days);
        }
        send(res, 200, { schools });
      }
    } else if (pathname === "/api/school-mail/replies") {
      await handleSchoolMail(req, res, user, true);
    } else if (pathname === "/api/school-mail") {
      await handleSchoolMail(req, res, user);
    } else if (pathname === "/api/institutions" && req.method === "GET") {
      send(res, 200, { institutions: await listInstitutions() });
    } else if (institutionRoute && req.method === "PATCH") {
      const id = institutionRoute[1];
      const edits = await readInstitutionEdits(req);
      const institution = BigInt(id) <= 9223372036854775807n ? await updateInstitution(id, edits) : undefined;
      if (institution) {
        await recordAudit(user, "institution_edit", "Учреждение № " + id);
        send(res, 200, { institution });
      }
      else send(res, 404, { error: "Учреждение не найдено." });
    } else if (refreshRoute && req.method === "POST") {
      const id = refreshRoute[1];
      const result = BigInt(id) <= 9223372036854775807n ? await refreshInstitution(id) : undefined;
      if (result === "conflict") {
        send(res, 409, { error: "Название или местоположение изменились во время поиска. Запустите обновление ещё раз." });
      } else if (result) {
        await recordAudit(user, "institution_refresh", "Учреждение № " + id);
        send(res, 200, result);
      } else {
        send(res, 404, { error: "Учреждение не найдено." });
      }
    } else if (pathname === "/api/agent" && req.method === "POST") {
      const query = await readQuery(req);
      if (req.headers.accept?.includes("application/x-ndjson")) await streamSearch(query, res, user);
      else {
        const result = await runAgent(query);
        await recordAudit(user, "search", "Найдено: " + result.institutions.length);
        send(res, 200, result);
      }
    } else if (pathname === "/api/institutions" || pathname === "/api/agent" || institutionRoute || refreshRoute) {
      send(res, 405, { error: "Метод не поддерживается." });
    } else {
      send(res, 404, { error: "Маршрут не найден." });
    }
  } catch (error) {
    if (error instanceof DatabaseError) {
      console.error(error);
      send(res, 500, { error: "Не удалось прочитать или сохранить данные в PostgreSQL." });
    } else {
      send(res, error instanceof InputError ? 400 : 503, {
        error: error instanceof Error ? error.message : "Ошибка сервера.",
      });
    }
  }
  return true;
}
