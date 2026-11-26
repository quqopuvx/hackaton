import type { InstitutionDetails } from "../types.ts";

export interface SchoolSource {
  url: string;
  title: string;
  excerpt: string;
  pageIntro?: string;
}

const yakutskRegion = "Республика Саха (Якутия)";

export function isYakutskSchoolList(normalizedQuery: string): boolean {
  return /^(?:(?:найди|покажи|перечисли) )?(?:все )?(?:школы (?:города )?якутска|школы (?:в городе|в) якутске|школы якутск)$/u.test(normalizedQuery);
}

export function numberedSchool(name: string): number | undefined {
  const number = /(?:сош|школа)[\s«"»]*(?:№|[Nn]|номер)?\s*(\d{1,3})(?!\d)/iu.exec(name)?.[1];
  return number ? Number(number) : undefined;
}

/** This portal assigns one host to each school; require the city in the address on that host. */
export function schoolsFromYakutskPortal(sources: SchoolSource[]): InstitutionDetails[] {
  const schools = new Map<number, InstitutionDetails>();
  for (const source of sources) {
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.port || url.username || url.password) continue;
    const hostNumber = /^(?:ykt-s|sosh|school)(\d{1,3})\.obr\.sakha\.gov\.ru$/i.exec(url.hostname)?.[1];
    if (!hostNumber) continue;
    const number = Number(hostNumber);
    if (schools.has(number)) continue;
    const addressContext = `${source.excerpt}\n${source.pageIntro ?? ""}`;
    const hasCity = /(?:\b677\d{3}\b[^\n]{0,130}|адрес[^\n]{0,130}|республика\s+саха[^\n]{0,50})(?:город\s+|г\.\s*)якутск(?=[\s,;.]|$)/iu.test(addressContext);
    const schoolPage = /(?:^|\/)(?:sveden|svedenija-ob-obrazovatelnoj-organizatsii)(?:\/|$)/i.test(url.pathname) ||
      numberedSchool(source.title) === number;
    if (!hasCity || !schoolPage) continue;
    // Urban district labels can also occur in addresses of nearby villages.
    if (/(?:г(?:ород)?\.?)\s*якутск\s*[,;]\s*(?:с(?:ело)?\.|село\s|пос(?:елок)?\.|пос[её]лок\s)/iu.test(addressContext)) continue;
    const titleNumber = numberedSchool(source.title);
    if (titleNumber !== undefined && titleNumber !== number) continue;
    schools.set(number, {
      name: `Школа №${number}`, city: "Якутск", region: yakutskRegion, institutionType: "school",
      leaderName: null, institutionEmail: null, institutionPhone: null, sourceUrls: [url.href],
    });
  }
  return [...schools.values()];
}
