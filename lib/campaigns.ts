import type { SchoolMailOutcome } from "./school-mail.ts";
import type { Institution } from "./types.ts";

export const campaignMessageLimit = 1000;
export const campaignSchoolLimit = 120;

export type CampaignDraft = { subject: string; text: string };
export type CampaignMailPreset = { campaignId: string; recipientIds: string[]; draft: CampaignDraft };
export type CampaignMessage = { role: "user" | "assistant"; text: string };
export type CampaignDetails = { title: string; schedule: string; registrationUrl: string };

export interface CampaignState {
  messages: CampaignMessage[];
  schoolIds: string[];
  schoolChoiceIds?: string[];
  lastAddedSchoolId?: string;
  draft: CampaignDraft | null;
  upperGrades: boolean;
}

export interface CampaignSummary {
  id: string;
  title: string;
}

export interface Campaign extends CampaignSummary {
  schedule: string;
  registrationUrl: string;
  version: number;
  state: CampaignState;
}

export type CampaignView = Campaign & {
  schools: Institution[];
  schoolChoices: Institution[];
  deliveries: Pick<SchoolMailOutcome, "id" | "status">[];
};

export function hasUpperGrades(school: Institution): boolean {
  const enrollment = school.schoolEnrollment;
  return (enrollment?.upperGrades ?? 0) > 0 || (enrollment?.grade10 ?? 0) > 0 || (enrollment?.grade11 ?? 0) > 0;
}
