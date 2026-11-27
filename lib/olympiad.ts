export const olympiad = {
  consentVersion: "demo-v2",
} as const;

export interface OlympiadSchool {
  id: string;
  name: string;
  city: string;
  region: string;
}

export interface SchoolApplicant {
  id: string;
  name: string;
  email: string;
  invitationOptIn: boolean;
}

export const applicantMailDelays = [7, 14, 30] as const;
export const applicantUnsubscribeLabel = "Отказаться от рассылки";
export const applicantMailBatchLimit = 6;

export type ApplicantMailRecipient = Pick<SchoolApplicant, "id" | "name" | "email">;

export const applicantMailTemplates = {
  admission: {
    name: "Приглашение поступить",
    subject: "Приглашаем познакомиться с нашим вузом",
    text: "Здравствуйте, {{имя}}!\n\nПриглашаем вас познакомиться с направлениями обучения в нашем вузе. Если хотите узнать о программах, вступительных испытаниях или подаче документов, ответьте на это письмо.\n\nС уважением, приёмная комиссия",
  },
  olympiad: {
    name: "Приглашение на олимпиаду",
    subject: "Приглашаем на олимпиаду для абитуриентов",
    text: "Здравствуйте, {{имя}}!\n\nПриглашаем вас принять участие в олимпиаде для будущих абитуриентов. Ответьте на это письмо, и мы расскажем, как зарегистрироваться и подготовиться к заданиям.\n\nС уважением, приёмная комиссия",
  },
  openDay: {
    name: "День открытых дверей",
    subject: "Приглашаем на день открытых дверей",
    text: "Здравствуйте, {{имя}}!\n\nПриглашаем вас на день открытых дверей нашего вуза. На встрече можно познакомиться с программами и задать вопросы о поступлении. Ответьте на это письмо, чтобы узнать дату и формат встречи.\n\nС уважением, приёмная комиссия",
  },
} as const;

export interface ApplicantMailSettings {
  enabled: boolean;
  delayDays: typeof applicantMailDelays[number];
  subject: string;
  text: string;
}
