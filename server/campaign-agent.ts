import { completeCampaignTurn, parseModelJson, runAgent } from "../lib/ai/agent.ts";
import { hasUpperGrades, type Campaign, type CampaignDraft, type CampaignState } from "../lib/campaigns.ts";
import { isSingleEmail, schoolMailSubjectLimit, schoolMailTextLimit, schoolNameToken } from "../lib/school-mail.ts";
import { normalize } from "../lib/store.ts";
import { resolveCampaignSchool } from "./campaign-schools.ts";

const instructions = `Ты помощник приёмной комиссии по профориентационным кампаниям.
На каждый запрос верни только объект JSON без оформления Markdown с полями reply, searchQuery, schoolName, schoolCity, schoolRegion, upperGrades, prepareDraft, subject, body.
reply — краткий ответ на русском, без утверждений о выполненном поиске, отправке или найденных школах.
Обработай все действия из последнего сообщения (message), используя историю для уточнения контекста.
schoolName, schoolCity, schoolRegion заполни, когда пользователь просит добавить конкретную школу к текущей подборке.
В schoolName укажи только название или номер школы (например «СОШ № 31»), в остальных полях — город и регион в именительном падеже.
Если после такого запроса получено уточнение «она в Якутске», возьми название из предыдущего запроса и укажи «Якутск» в schoolCity.
«Добавь в список школу № 31 в Якутске» означает schoolName "Школа № 31", schoolCity "Якутск", schoolRegion "" и searchQuery "".
При добавлении всегда оставляй searchQuery пустым. Без просьбы добавить заполни поля schoolName, schoolCity и schoolRegion пустыми строками.
searchQuery — самостоятельный короткий запрос для новой подборки, начинающийся со слова «Школы».
Заполни его, когда пользователь просит найти или подобрать школы.
Включай только явно запрошенное местоположение, название и критерии. Не добавляй тематику
мероприятия, уровень подготовки или профиль школы, если пользователь не запросил такой фильтр.
«Подбери школы Якутска и подготовь приглашение» означает searchQuery "Школы Якутска" и prepareDraft true.
«Найди СОШ № 31 в Якутске» означает searchQuery "Школы: СОШ № 31 в Якутске". Без просьбы поиска верни пустую строку.
upperGrades — true, если для нового поиска запрошены 10–11 классы или старшеклассники.
prepareDraft — true, если пользователь просит подготовить или изменить письмо. Можно одновременно искать и писать.
Если campaign.eventDetailsComplete равно true, верни тему и основной текст письма в subject и body.
В теле используй только подтверждённые сведения из контекста и понятную просьбу к школе.
Приветствие, дата, время и ссылка добавятся автоматически. Не вставляй ссылки, даты, поля для заполнения и подписи.
При отсутствии данных или если черновик не запрошен верни пустые subject и body. Отправку выполняет только сотрудник.`;

const schema = {
  type: "object",
  properties: {
    reply: { type: "string" }, searchQuery: { type: "string" }, schoolName: { type: "string" },
    schoolCity: { type: "string" }, schoolRegion: { type: "string" }, upperGrades: { type: "boolean" },
    prepareDraft: { type: "boolean" }, subject: { type: "string" }, body: { type: "string" },
  },
  required: ["reply", "searchQuery", "schoolName", "schoolCity", "schoolRegion", "upperGrades", "prepareDraft", "subject", "body"],
  additionalProperties: false,
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.replaceAll("\0", "").trim() : "";
}

function readPlan(raw: string) {
  try {
    const parsed = parseModelJson(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const fields = parsed as Record<string, unknown>;
    const plan = {
      reply: clean(fields.reply), searchQuery: clean(fields.searchQuery),
      schoolName: clean(fields.schoolName), schoolCity: clean(fields.schoolCity), schoolRegion: clean(fields.schoolRegion),
      upperGrades: fields.upperGrades === true, prepareDraft: fields.prepareDraft === true,
      subject: clean(fields.subject), body: clean(fields.body),
    };
    return plan.reply || plan.searchQuery || plan.schoolName || plan.prepareDraft ? plan : null;
  } catch {
    return null;
  }
}

function eventDetailsPrompt({ schedule, registrationUrl }: Campaign): string {
  const fields = [!schedule && "дату и время мероприятия", !registrationUrl && "ссылку на регистрацию"].filter(Boolean);
  return `Заполните ${fields.join(" и ")} в разделе «Данные мероприятия», затем попросите подготовить письмо.`;
}

function buildDraft(campaign: Campaign, draftSubject: string, body: string): CampaignDraft | null {
  const subject = draftSubject.replace(/\s+/g, " ").slice(0, schoolMailSubjectLimit);
  const text = `Здравствуйте, коллеги из «${schoolNameToken}»!\n\n${body}\n\nКогда: ${campaign.schedule}\nРегистрация: ${campaign.registrationUrl}`;
  return subject && body && text.length <= schoolMailTextLimit && !/https?:\/\//i.test(body) ? { subject, text } : null;
}

export function recordCampaignExchange(state: CampaignState, message: string, reply: string): CampaignState {
  return { ...state, messages: [...state.messages.slice(-58), { role: "user", text: message }, { role: "assistant", text: reply }] };
}

export async function planCampaignTurn(campaign: Campaign, message: string): Promise<CampaignState> {
  const { title, schedule, registrationUrl, state } = campaign;
  const draftOnly = /^(?:пожалуйста )?(?:подготовь|подготовить|напиши|составь) (?:(?:черновик )?(?:письмо|письма|приглашение|приглашения)|черновик)(?: для школ(?: из подборки)?)?(?: пожалуйста)?$/u
    .test(normalize(message));
  if (draftOnly && (!schedule || !registrationUrl)) {
    return recordCampaignExchange(state, message, eventDetailsPrompt(campaign));
  }

  const input = JSON.stringify({
    campaign: { title, eventDetailsComplete: Boolean(schedule && registrationUrl), ...(!draftOnly && { schedule, registrationUrl }) },
    history: state.messages.slice(-14), message,
    previousDraft: draftOnly ? null : state.draft, schoolCount: state.schoolIds.length, upperGrades: state.upperGrades,
  });
  const request = completeCampaignTurn(instructions, input, schema).then(readPlan);
  let plan = draftOnly ? await request.catch(() => null) : await request;
  if (!plan && !draftOnly) {
    plan = readPlan(await completeCampaignTurn(`${instructions}\nПроверь синтаксис JSON и укажи все обязательные поля.`, input, schema));
    if (!plan) throw new Error("Агент дважды вернул ответ в неверном формате. Попробуйте уточнить запрос.");
  }

  const updates: string[] = [];
  const next = { ...state };
  const prepareDraft = draftOnly || plan?.prepareDraft;
  const query = draftOnly ? "" : (plan?.searchQuery ?? "").slice(0, 390);
  const targetName = draftOnly ? "" : (plan?.schoolName ?? "").slice(0, 180);
  if (targetName) {
    try {
      updates.push(await resolveCampaignSchool(next, {
        name: targetName, city: (plan?.schoolCity ?? "").slice(0, 80), region: (plan?.schoolRegion ?? "").slice(0, 80),
      }));
    } catch (error) {
      if (!prepareDraft) throw error;
      updates.push("Добавить школу пока не удалось. Повторите подборку отдельным сообщением.");
    }
  } else if (/(?:^|\s)(?:добавь(?:те)?|внеси(?:те)?|включи(?:те)?)\s+[^.!?]*школ/iu.test(message) && query) {
    updates.push("Укажите точное название или номер школы и её город.");
  } else if (/[\p{L}\p{N}]/u.test(query)) {
    try {
      const result = await runAgent(/^школы(?:[\s:]|$)/iu.test(query) ? query : `Школы: ${query}`);
      const schools = result.institutions.filter((school) => school.institutionType === "school");
      const priority = (school: typeof schools[number]) =>
        Number(isSingleEmail(school.institutionEmail?.trim() ?? "")) + Number(plan?.upperGrades === true && hasUpperGrades(school)) * 2;
      next.schoolIds = schools.sort((a, b) => priority(b) - priority(a)).slice(0, 60).map(({ id }) => id);
      next.schoolChoiceIds = [];
      delete next.lastAddedSchoolId;
      next.upperGrades = plan?.upperGrades === true;
      updates.push(next.schoolIds.length
        ? `Школ в подборке: ${next.schoolIds.length}.${result.partial ? " Поиск вернул частичные результаты." : ""}`
        : "По этому запросу школы не найдены. Попробуйте уточнить город или район.");
    } catch (error) {
      if (!prepareDraft) throw error;
      updates.push("Поиск школ не завершился. Можно повторить подборку отдельным сообщением.");
    }
  }
  if (prepareDraft) {
    if (!schedule || !registrationUrl) {
      updates.push(eventDetailsPrompt(campaign));
    } else {
      const generated = buildDraft(campaign, plan?.subject ?? "", plan?.body ?? "");
      if (generated) {
        next.draft = generated;
        updates.push("Черновик готов. Проверьте его в почтовой форме перед отправкой.");
      } else if (draftOnly && state.draft) {
        updates.push("Не удалось обновить текст. Предыдущий черновик доступен в кампании.");
      } else if (draftOnly) {
        next.draft = buildDraft(campaign, `Приглашение на мероприятие «${title}»`,
          `Приглашаем вашу школу на мероприятие «${title}». Пожалуйста, поделитесь приглашением с учениками и классными руководителями. Желающие могут зарегистрироваться по ссылке ниже.`);
        updates.push(next.draft ? "Подготовил черновик по шаблону. Его можно отредактировать в почтовой форме."
          : "Не удалось подготовить черновик. Проверьте название мероприятия.");
      } else {
        updates.push("Не удалось подготовить черновик. Попросите агента сформулировать приглашение ещё раз.");
      }
    }
  }
  const reply = [...updates, ...(!updates.length ? [(plan?.reply ?? "").slice(0, 1500)] : [])]
    .filter(Boolean).join("\n\n") || "Уточните, какие школы подобрать или какое письмо подготовить.";
  return recordCampaignExchange(next, message, reply);
}
