import type { IncomingMessage, ServerResponse } from "node:http";
import { DatabaseError } from "pg";
import { randomUUID } from "node:crypto";
import { authorizeSchoolMail, sendSchoolMail } from "./school-mail.ts";
import { readSchoolReplies } from "./school-replies.ts";
import { isSingleEmail, schoolMailDraft, schoolMailLimit, schoolMailSubjectLimit, schoolMailTemplates, schoolMailTextLimit, type SchoolMailRecipient, type SchoolMailTemplate } from "../lib/school-mail.ts";
import { refreshInstitution, runAgent } from "../lib/ai/agent.ts";
import { institutionTypeLabels, type InstitutionType } from "../lib/institution-types.ts";
import { findSchoolMailTemplate, listInstitutions, listSchoolMailHistory, listSchoolMailReminders, listSchoolMailTemplates, normalize, saveSchoolMailTemplate, updateInstitution } from "../lib/store.ts";
import type { InstitutionEdits, SearchEvent } from "../lib/types.ts";

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

const uuidPattern = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

function isMailLine(value: unknown, limit: number): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= limit && !/[\r\n\0]/.test(value);
}

function isMailText(value: unknown): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= schoolMailTextLimit && !value.includes("\0");
}

async function handleMailTemplates(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "GET") {
    send(res, 200, { templates: await listSchoolMailTemplates() });
    return;
  }
  if (req.method !== "POST") {
    send(res, 405, { error: "Метод не поддерживается." });
    return;
  }
  if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new InputError("Ожидается application/json.");
  }
  const { id, name, subject, text } = await readBody(req, 24 * 1024);
  if (id !== undefined && (typeof id !== "string" || !uuidPattern.test(id))) throw new InputError("Некорректный шаблон.");
  if (!isMailLine(name, 100) || !isMailLine(subject, schoolMailSubjectLimit) || !isMailText(text)) {
    throw new InputError("Заполните название, тему и текст шаблона.");
  }
  const template = await saveSchoolMailTemplate({
    id: id ?? randomUUID(), name: name.trim(), subject: subject.trim(), text: text.trim(),
  }, id !== undefined);
  if (template) send(res, id === undefined ? 201 : 200, { template });
  else send(res, 404, { error: "Шаблон не найден." });
}

async function handleSchoolMail(req: IncomingMessage, res: ServerResponse, replies = false): Promise<void> {
  if (req.method !== "POST") {
    send(res, 405, { error: "Метод не поддерживается." });
    return;
  }
  if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new InputError("Ожидается application/json.");
  }
  if (replies) {
    const fetchSite = req.headers["sec-fetch-site"];
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
      send(res, 403, { error: "Откройте вкладку ответов на странице приложения." });
      return;
    }
    send(res, 200, { replies: await readSchoolReplies() });
    return;
  }
  const { requestId, template, recipients, accessCode, text, subject } = await readBody(req, 32 * 1024);
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
    throw new InputError(`Выберите шаблон и от 1 до ${schoolMailLimit} школ.`);
  }
  const selected = new Map<string, SchoolMailRecipient>();
  for (const recipient of recipients) {
    const { id, email } = recipient ?? {};
    if (typeof id !== "string" || !/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n ||
        typeof email !== "string" || !isSingleEmail(email) || selected.has(id)) {
      throw new InputError("Проверьте список школ и их почтовые адреса.");
    }
    selected.set(id, { id, email });
  }
  let message: { subject: string; text: string };
  if (Object.hasOwn(schoolMailTemplates, template)) {
    const builtin = template as SchoolMailTemplate;
    message = { subject: schoolMailTemplates[builtin], text: text ?? schoolMailDraft(builtin) };
  } else {
    const saved = await findSchoolMailTemplate(template);
    if (!saved) throw new InputError("Выбранный шаблон не найден.");
    if (subject !== undefined && !isMailLine(subject, schoolMailSubjectLimit)) throw new InputError("Некорректная тема письма.");
    message = { subject: subject?.trim() ?? saved.subject, text: text ?? saved.text };
  }
  send(res, 200, { outcomes: await sendSchoolMail(requestId, template, [...selected.values()], message) });
}

async function streamSearch(query: string, res: ServerResponse): Promise<void> {
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

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const { pathname } = url;
  if (!pathname.startsWith("/api/")) return false;
  const institutionRoute = /^\/api\/institutions\/([1-9][0-9]{0,18})$/.exec(pathname);
  const refreshRoute = /^\/api\/institutions\/([1-9][0-9]{0,18})\/refresh$/.exec(pathname);

  try {
    if (pathname === "/api/school-mail/templates") {
      await handleMailTemplates(req, res);
    } else if (pathname === "/api/school-mail/history" || pathname === "/api/school-mail/reminders") {
      if (req.method !== "GET") send(res, 405, { error: "Метод не поддерживается." });
      else if (pathname.endsWith("/history")) {
        const page = Number(url.searchParams.get("page") ?? "1");
        if (!Number.isInteger(page) || page < 1 || page > 10_000) throw new InputError("Некорректный номер страницы.");
        send(res, 200, await listSchoolMailHistory(page));
      } else {
        const days = Number(url.searchParams.get("days") ?? "7");
        if (![7, 14, 30].includes(days)) throw new InputError("Выберите срок 7, 14 или 30 дней.");
        let schools = await listSchoolMailReminders(days);
        if (schools.length) {
          await readSchoolReplies();
          schools = await listSchoolMailReminders(days);
        }
        send(res, 200, { schools });
      }
    } else if (pathname === "/api/school-mail/replies") {
      await handleSchoolMail(req, res, true);
    } else if (pathname === "/api/school-mail") {
      await handleSchoolMail(req, res);
    } else if (pathname === "/api/institutions" && req.method === "GET") {
      send(res, 200, { institutions: await listInstitutions() });
    } else if (institutionRoute && req.method === "PATCH") {
      const id = institutionRoute[1];
      const edits = await readInstitutionEdits(req);
      const institution = BigInt(id) <= 9223372036854775807n ? await updateInstitution(id, edits) : undefined;
      if (institution) send(res, 200, { institution });
      else send(res, 404, { error: "Учреждение не найдено." });
    } else if (refreshRoute && req.method === "POST") {
      const id = refreshRoute[1];
      const result = BigInt(id) <= 9223372036854775807n ? await refreshInstitution(id) : undefined;
      if (result === "conflict") {
        send(res, 409, { error: "Название или местоположение изменились во время поиска. Запустите обновление ещё раз." });
      } else if (result) {
        send(res, 200, result);
      } else {
        send(res, 404, { error: "Учреждение не найдено." });
      }
    } else if (pathname === "/api/agent" && req.method === "POST") {
      const query = await readQuery(req);
      if (req.headers.accept?.includes("application/x-ndjson")) await streamSearch(query, res);
      else send(res, 200, await runAgent(query));
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
