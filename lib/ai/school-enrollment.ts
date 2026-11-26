import { load } from "cheerio/slim";
import { convert } from "html-to-text";
import type { SchoolEnrollment } from "../types.ts";
import { readPublicHtml } from "./official-email.ts";

type CountKind = "grade10" | "grade11" | "upperGrades" | "total";
const countWords = "(?:(?:общая|всего)\\s+)?(?:численность|количество)\\s+(?:обучающихся|учащихся|школьников|учеников)";
const countHeading = new RegExp(`^${countWords}(?:\\s*[,()]?\\s*(?:чел\\.?|человек)\\)?)?$`, "iu");
const countValue = "(\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+|\\d{1,5})";
const countLine = new RegExp(`^${countWords}\\s*(?::|[–—-])\\s*${countValue}(?:\\s*(?:чел\\.?|человек|учащихся|обучающихся))?$`, "iu");
const personValue = new RegExp(`${countValue}\\s*(?:чел\\.?|человек|учащихся|обучающихся|учеников)$`, "iu");
const gradeRange = /10\s*[-–—−]\s*11(?:\s*[-–—]?\s*(?:х|е|ые))?\s+класс/iu;
const overallSchool = /(?:в|по)\s+(?:школе|лицее|гимназии|образовательной организации|учреждению)(?![а-яё])/iu;
const programHeading = /^(?:\d+[.)]\s*)?(?:(?:уровень|основная|адаптированная|образовательная программа|программа)(?![а-яё])|(?:начальное|основное|среднее) общее образование)/iu;
const educationPath = /\/(?:sveden\/education|education|obrazovanie|chislennost(?:-obuchayushchikhsya)?)\/?$/i;

function clean(value: string): string {
  return value.replace(/\s+/gu, " ").trim().replace(/[.;:]$/, "").trim();
}

function label(value: string): CountKind | undefined {
  if (/(?:вакант|свободн|план приема|адаптирован|иностран|бюджет|договор|количество классов)/iu.test(value)) return;
  if (gradeRange.test(value) || /^(?:\d+[.)]\s*)?(?:(?:уровень\s*[:–-]?\s*)?среднее общее образование|(?:основная\s+)?образовательная программа среднего общего образования)(?![а-яё])/iu.test(value)) {
    return "upperGrades";
  }
  const grade = /\b(10|11)(?:\s*[-–—]?\s*(?:й|го|е|ых|х))?\s+класс(?:а|ов|ы|е)?(?![а-яё])(?!(?:\s+[«"]?[а-яё][»"]?)(?:\s*[:–—-]|$))/iu.exec(value)?.[1];
  if (grade) return grade === "10" ? "grade10" : "grade11";
  if (overallSchool.test(value) || /^(?:всего|итого|всего обучающихся|учащихся всего)$/iu.test(value)) return "total";
}

function count(value: string): number | undefined {
  const text = clean(value).replace(/[\s\u00a0\u202f]+/gu, "").replace(/(?:чел\.?|человек)$/iu, "");
  if (!/^\d{1,5}$/.test(text) || Number(text) > 25_000) return;
  return Number(text);
}

export function parseSchoolEnrollment(html: string, sourceUrl: string): SchoolEnrollment | undefined {
  const $ = load(html);
  $("script,style,noscript,template,nav,footer,[hidden],[aria-hidden='true']").remove();
  const main = $("main").first();
  const area = main.length ? main : $("body");
  const counts: Record<CountKind, Set<number>> = {
    grade10: new Set(), grade11: new Set(), upperGrades: new Set(), total: new Set(),
  };
  function record(kind: CountKind | undefined, value: string | undefined): void {
    const number = value === undefined ? undefined : count(value);
    if (kind && number !== undefined) counts[kind].add(number);
  }

  area.find("table").each((_, table) => {
    let countColumn: number | undefined;
    let gradeColumns = new Map<number, CountKind>();
    const tableText = clean($(table).text());
    const schoolWide = /начальн[а-яё]+ общ[а-яё]+ образован/iu.test(tableText) &&
      /основн[а-яё]+ общ[а-яё]+ образован/iu.test(tableText) &&
      /средн[а-яё]+ общ[а-яё]+ образован/iu.test(tableText);
    const tableLabel = (value: string) => {
      const kind = label(value);
      return kind === "total" && !overallSchool.test(value) && !schoolWide ? undefined : kind;
    };
    $(table).find("tr").each((_, row) => {
      if ($(row).closest("table").get(0) !== table) return;
      const cells = $(row).children("th,td").toArray().flatMap((cell) => {
        const span = Math.min(Number($(cell).attr("colspan")) || 1, 20);
        return Array.from({ length: span }, () => clean($(cell).text()));
      });
      const columns = cells.flatMap((value, index) => countHeading.test(value) ? [index] : []);
      if (columns.length === 1 && cells.some((value) => /уровень|класс|образовательная программа/iu.test(value))) {
        countColumn = columns[0];
        return;
      }
      if (countColumn !== undefined && cells.length > countColumn) {
        const kinds = new Set(cells.flatMap((value, index) => {
          const kind = index !== countColumn ? tableLabel(value) : undefined;
          return kind ? [kind] : [];
        }));
        if (kinds.size === 1) record(kinds.values().next().value, cells[countColumn]);
      }

      if (cells.some((value) => countHeading.test(value))) {
        gradeColumns.forEach((kind, index) => record(kind, cells[index]));
      } else {
        const labeled = cells.flatMap((value, index) => {
          const kind = tableLabel(value);
          return kind ? [[index, kind] as const] : [];
        });
        if (labeled.length >= 2 && labeled.every(([index]) => count(cells[index]) === undefined)) {
          gradeColumns = new Map(labeled);
        }
      }
    });
  });

  const text = convert(area.html() ?? "", { wordwrap: false, selectors: [
    { selector: "table", format: "skip" }, { selector: "img", format: "skip" },
    { selector: "a", options: { ignoreHref: true } },
  ] });
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    const kind = label(line);
    if (!kind) continue;
    const inline = new RegExp(`[:–—-]\\s*${countValue}$`, "u").exec(line);
    const people = personValue.exec(line);
    if (new RegExp(countWords, "iu").test(line) || people) record(kind, inline?.[1] ?? people?.[1]);
    if (programHeading.test(line) || /класс(?:ы|ов)?$/iu.test(line)) {
      for (const next of lines.slice(index + 1, index + 7)) {
        if (programHeading.test(next) || label(next)) break;
        const metric = countLine.exec(next);
        if (metric) {
          record(kind, metric[1]);
          break;
        }
      }
    }
  }

  const unique = (kind: CountKind) => counts[kind].size === 1 ? [...counts[kind]][0] : null;
  let grade10 = unique("grade10");
  let grade11 = unique("grade11");
  let upperGrades = unique("upperGrades");
  let total = unique("total");
  if (grade10 !== null && grade11 !== null) {
    const sum = grade10 + grade11;
    if (!counts.upperGrades.size) upperGrades = sum;
    else if (upperGrades !== sum) { grade10 = null; grade11 = null; }
  }
  if (upperGrades !== null) {
    if (grade10 !== null && grade10 > upperGrades) grade10 = null;
    if (grade11 !== null && grade11 > upperGrades) grade11 = null;
  }
  if (total !== null && total < Math.max(upperGrades ?? 0, grade10 ?? 0, grade11 ?? 0)) total = null;
  if ([grade10, grade11, upperGrades, total].every((value) => value === null)) return;

  const years = new Set<string>();
  for (const [, start, end] of area.text().matchAll(/\b(20\d{2})\s*[\/–—-]\s*(20\d{2}|\d{2})\s*учебн/giu)) {
    const next = end.length === 2 ? "20" + end : end;
    if (Number(next) === Number(start) + 1) years.add(`${start}/${next}`);
  }
  return { grade10, grade11, upperGrades, total, academicYear: years.size === 1 ? [...years][0] : null, sourceUrl };
}

type IdentityCheck = (headings: string, text: string) => boolean;

function readIdentity(html: string, matchesInstitution: IdentityCheck): boolean {
  const $ = load(html);
  $("script,style,template,noscript").remove();
  const headings = $("title,h1,header,[itemprop='fullName'],[itemprop='shortName']")
    .toArray().map((node) => clean($(node).text())).join(" ");
  return matchesInstitution(headings, clean($("body").text()));
}

export async function readOfficialSchoolEnrollment(
  sources: string[], matchesInstitution: IdentityCheck, signal?: AbortSignal,
): Promise<SchoolEnrollment | undefined> {
  const sites = new Map<string, Set<string>>();
  for (const source of sources) {
    const url = new URL(source);
    const section = /^(.*?)\/sveden(?:\/|$)/i.exec(url.pathname);
    const root = new URL((section?.[1] ?? "") + "/", url.origin);
    const pages = sites.get(root.href) ?? new Set<string>();
    if (educationPath.test(url.pathname) && !url.search) pages.add(url.href);
    pages.add(new URL("sveden/education/", root).href);
    sites.set(root.href, pages);
  }
  const candidates = await Promise.all([...sites].slice(0, 2).map(async ([root, pages]) => {
    const fetched = new Map<string, Promise<string | undefined>>();
    async function read(url: string, linkedFromVerifiedHome = false): Promise<SchoolEnrollment | undefined> {
      const address = new URL(url);
      address.hash = "";
      let pending = fetched.get(address.href);
      if (!pending) {
        pending = readPublicHtml(address, true, signal);
        fetched.set(address.href, pending);
      }
      const html = await pending;
      if (!html || (!linkedFromVerifiedHome && !readIdentity(html, matchesInstitution))) return;
      return parseSchoolEnrollment(html, address.href);
    }
    const direct = (await Promise.all([...pages].slice(0, 2).map((url) => read(url)))).filter((page) => page !== undefined);
    if (direct.some((page) => page.upperGrades !== null)) return direct;
    const home = await readPublicHtml(new URL(root), true, signal);
    if (!home || !readIdentity(home, matchesInstitution)) return direct;
    const $ = load(home);
    const links = new Set<string>();
    for (const anchor of $("a[href]").toArray()) {
      const href = $(anchor).attr("href");
      if (!href || !URL.canParse(href, root)) continue;
      const url = new URL(href, root);
      url.hash = "";
      if (url.origin === new URL(root).origin && !url.search && educationPath.test(url.pathname)) links.add(url.href);
    }
    const linked = (await Promise.all([...links].slice(0, 2).map((url) => read(url, true))))
      .filter((page) => page !== undefined);
    return [...direct, ...linked];
  }));
  const pages = candidates.flat();
  const score = (page: SchoolEnrollment) => Number(page.upperGrades !== null) * 4 + Number(page.total !== null) * 2 +
    Number(page.academicYear !== null) + Number(page.grade10 !== null) + Number(page.grade11 !== null);
  return pages.sort((a, b) => score(b) - score(a) || (b.academicYear ?? "").localeCompare(a.academicYear ?? ""))[0];
}
