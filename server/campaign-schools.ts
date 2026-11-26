import { runAgent } from "../lib/ai/agent.ts";
import { campaignSchoolLimit, type CampaignState } from "../lib/campaigns.ts";
import { listInstitutions, normalize } from "../lib/store.ts";
import type { Institution } from "../lib/types.ts";

export type SchoolTarget = { name: string; city: string; region: string };

function schoolName(text: string): string {
  return normalize(text.replaceAll("№", " ")).replace(/(?:^| )(?:гбоу|мбоу|мобу|мбу|маоу|мкоу|гкоу|аоу|моу|гаоу|сош|оош|нош)(?= |$)/gu,
    (word) => /(?:сош|оош|нош)$/u.test(word) ? " школа" : "").trim();
}

function schoolNumber(name: string) {
  return /(?:^| )(школа|лицей|гимназия) (?:номер |no? ?)?(\d+[а-яa-z]?)(?= |$)/u.exec(name);
}

function containsWords(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function place(text: string): string {
  return normalize(text).replace(/(?:^| )(?:г|город|с|село|п|поселок|пгт|республика|область|край)(?= |$)/gu, "").trim();
}

function matchesPlace(actual: string, expected: string): boolean {
  return !expected || containsWords(place(actual), expected);
}

function matchingSchools(schools: Institution[], target: SchoolTarget): Institution[] {
  const name = schoolName(target.name);
  const number = schoolNumber(name);
  const city = place(target.city);
  const region = place(target.region);
  if (!name || /^(?:школа|школы|гимназия|лицей|другая школа|еще школа|эту школу)$/u.test(name)) return [];
  return schools.filter((school) => {
    if (school.institutionType !== "school" || !matchesPlace(school.city, city) || !matchesPlace(school.region, region)) return false;
    const candidate = schoolName(school.name);
    if (!number) return containsWords(candidate, name) ||
      containsWords(candidate, name.replace(/^(?:школа|гимназия|лицей) (?=.+)/u, ""));
    const other = schoolNumber(candidate);
    return other?.[2] === number[2] && (number[1] === "школа" || other[1] === number[1]);
  });
}

export function addCampaignSchool(state: CampaignState, school: Institution, source?: string): string {
  state.schoolChoiceIds = [];
  if (state.schoolIds.includes(school.id)) return `«${school.name}» уже в подборке.`;
  if (state.schoolIds.length >= campaignSchoolLimit) return `В подборке уже ${campaignSchoolLimit} школ.`;
  state.schoolIds = [...state.schoolIds, school.id];
  state.lastAddedSchoolId = school.id;
  return `Добавил в подборку «${school.name}» (${school.city})${source ? ` — ${source}` : ""}.`;
}

export async function resolveCampaignSchool(state: CampaignState, target: SchoolTarget): Promise<string> {
  state.schoolChoiceIds = [];
  if (state.schoolIds.length >= campaignSchoolLimit) return `В подборке уже ${campaignSchoolLimit} школ.`;
  const registryMatches = matchingSchools(await listInstitutions(), target);
  if (registryMatches.length === 1) return addCampaignSchool(state, registryMatches[0], "из реестра");

  if (!registryMatches.length && !place(target.city) && !place(target.region)) {
    return `Укажите город или регион, чтобы найти «${target.name}».`;
  }
  const matches = registryMatches.length ? registryMatches : matchingSchools((await runAgent(
    `Школы: ${[target.name, target.city, target.region].filter(Boolean).join(", ")}`.slice(0, 390),
  )).institutions, target);
  if (matches.length === 1) return addCampaignSchool(state, matches[0], "по результатам поиска");
  if (matches.length > 1) {
    state.schoolChoiceIds = matches.slice(0, 6).map(({ id }) => id);
    return "Найдено несколько подходящих школ. Выберите нужную или уточните название и город в чате.";
  }
  return `Не нашёл подтверждённое совпадение для «${target.name}». Проверьте название, номер и город.`;
}
