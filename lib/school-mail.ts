export const schoolMailTemplates = {
  contacts: "Уточнение контактных данных",
  cooperation: "Предложение о сотрудничестве",
  reminder: "Напоминание о предыдущем письме",
} as const;

export type SchoolMailTemplate = keyof typeof schoolMailTemplates;
export const schoolMailLimit = 20;
export const schoolMailTextLimit = 3000;
export const schoolMailSubjectLimit = 160;
export const schoolNameToken = "{{школа}}";

export interface SavedSchoolMailTemplate {
  id: string;
  name: string;
  subject: string;
  text: string;
}

export interface SchoolMailHistoryEntry {
  id: string;
  schoolId: string;
  schoolName: string;
  recipient: string;
  subject: string;
  status: Exclude<SchoolMailOutcome["status"], "skipped">;
  date: string;
}

export interface SchoolMailReminder {
  schoolId: string;
  schoolName: string;
  email: string | null;
  lastSentAt: string;
}

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
  const body = {
    contacts: "Пожалуйста, подтвердите актуальный адрес электронной почты и общий телефон вашей школы. Ответить можно на это письмо.",
    cooperation: "Хотели бы обсудить возможность сотрудничества с вашей школой. Если вам интересно, подскажите, пожалуйста, с кем можно связаться для обсуждения.",
    reminder: "Напоминаем о нашем предыдущем письме. Подскажите, пожалуйста, удалось ли с ним ознакомиться? Ответить можно на это письмо.",
  }[template];
  return `${greeting}\n\n${body}\n\nСпасибо!`;
}

export function renderSchoolMail(template: SchoolMailTemplate, name: string, draft = schoolMailDraft(template)) {
  return {
    subject: schoolMailTemplates[template],
    text: personalizeSchoolMail(draft, name),
  };
}

export function personalizeSchoolMail(draft: string, schoolName: string): string {
  return draft.trim().replaceAll(schoolNameToken, () => schoolName);
}
