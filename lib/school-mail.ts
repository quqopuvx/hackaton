export const schoolMailTemplates = {
  contacts: "Уточнение контактных данных",
  cooperation: "Предложение о сотрудничестве",
} as const;

export type SchoolMailTemplate = keyof typeof schoolMailTemplates;
export const schoolMailLimit = 20;
export const schoolMailTextLimit = 3000;
export const schoolNameToken = "{{школа}}";

export interface SchoolMailRecipient {
  id: string;
  email: string;
}

export interface SchoolMailOutcome {
  id: string;
  status: "sent" | "failed" | "uncertain" | "skipped" | "sending";
  message?: string;
}

export interface SchoolReply {
  id: number;
  schoolId: string;
  schoolName: string;
  sender: string;
  subject: string;
  receivedAt: string;
  text: string;
}

export function isSingleEmail(value: string): boolean {
  return value.length <= 254 && /^[a-z\d_+%-]+(?:\.[a-z\d_+%-]+)*@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+$/i.test(value);
}

export function schoolMailDraft(template: SchoolMailTemplate): string {
  const greeting = `Здравствуйте, коллеги из «${schoolNameToken}»!`;
  const body = template === "contacts"
    ? "Пожалуйста, подтвердите актуальный адрес электронной почты и общий телефон вашей школы. Ответить можно на это письмо."
    : "Хотели бы обсудить возможность сотрудничества с вашей школой. Если вам интересно, подскажите, пожалуйста, с кем можно связаться для обсуждения.";
  return `${greeting}\n\n${body}\n\nСпасибо!`;
}

export function renderSchoolMail(template: SchoolMailTemplate, name: string, draft = schoolMailDraft(template)) {
  return {
    subject: schoolMailTemplates[template],
    text: draft.trim().replaceAll(schoolNameToken, () => name),
  };
}
