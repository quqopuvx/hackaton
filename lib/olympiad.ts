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

export interface ApplicantMailSettings {
  enabled: boolean;
  delayDays: typeof applicantMailDelays[number];
  subject: string;
  text: string;
}
