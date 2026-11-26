import type { InstitutionType } from "./institution-types.ts";

export interface SchoolEnrollment {
  grade10: number | null;
  grade11: number | null;
  upperGrades: number | null;
  total: number | null;
  academicYear: string | null;
  sourceUrl: string;
}

export interface InstitutionDetails {
  name: string;
  city: string;
  region: string;
  institutionType: InstitutionType | null;
  leaderName: string | null;
  institutionEmail: string | null;
  institutionPhone: string | null;
  sourceUrls: string[];
  schoolEnrollment?: SchoolEnrollment | null;
}

export type InstitutionEdits = Partial<Omit<InstitutionDetails, "schoolEnrollment">>;

export interface Institution extends InstitutionDetails {
  id: string;
  responseStatus: "not_sent" | "awaiting_reply" | "replied";
}

export const responseStatusLabels = {
  not_sent: "Письмо не отправлено",
  awaiting_reply: "Ожидается ответ",
  replied: "Ответ получен",
} satisfies Record<Institution["responseStatus"], string>;

export interface SearchResult {
  institutions: Institution[];
  cached: boolean;
  partial?: boolean;
}

export interface InstitutionRefreshResult {
  institution: Institution;
  status: "updated" | "unchanged" | "not_verified";
}

export type SearchEvent =
  | { type: "institution"; institution: InstitutionDetails; checkingContacts: boolean }
  | { type: "complete"; result: SearchResult }
  | { type: "error"; message: string };
