import data from "./data/russian-regions.json";

type RegionGeometry = {
  code: string;
  name: string;
  alias?: string;
  path: string;
  marker?: [number, number];
};

export const regionMap = data as { width: number; height: number; regions: RegionGeometry[] };
export const regionByCode = new Map(regionMap.regions.map((region) => [region.code, region]));

function normalizeRegion(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/^(?:город|г) /, "");
}

const extraAliases: Record<string, string[]> = {
  "Крым": ["Республика Крым", "АР Крым"],
  "Севастополь": ["Город федерального значения Севастополь"],
  "Луганская область": ["ЛНР", "Луганская Народная Республика"],
  "Донецкая область": ["ДНР", "Донецкая Народная Республика"],
  "Республика Башкортостан": ["Башкирия", "Республика Башкирия"],
  "Республика Саха (Якутия)": ["Республика Саха", "Саха", "РС(Я)", "Саха (Якутия)"],
  "Республика Алтай": ["Горный Алтай"],
  "Московская область": ["Подмосковье", "Московская обл."],
  "Санкт-Петербург": ["Петербург", "СПб", "Санкт Петербург"],
  "Кемеровская область": ["Кузбасс", "Кемеровская область — Кузбасс"],
  "Ханты-Мансийский автономный округ — Югра": ["Югра", "ХМАО", "ХМАО-Югра", "Ханты-Мансийский автономный округ"],
  "Ямало-Ненецкий автономный округ": ["ЯНАО", "Ямало-Ненецкий АО", "Ямал"],
  "Ненецкий автономный округ": ["Ненецкий АО", "НАО"],
  "Чукотский автономный округ": ["Чукотка", "Чукотский АО"],
  "Еврейская автономная область": ["ЕАО"],
  "Республика Тыва": ["Тува", "Республика Тува"],
  "Республика Северная Осетия — Алания": ["Северная Осетия", "Северная Осетия — Алания"],
  "Кабардино-Балкарская Республика": ["Кабардино-Балкария", "КБР"],
  "Карачаево-Черкесская Республика": ["Карачаево-Черкесия", "КЧР"],
  "Чувашская Республика": ["Чувашская Республика — Чувашия"],
};
const codesByName = new Map<string, string>();
for (const region of regionMap.regions) {
  const name = normalizeRegion(region.name);
  const aliases = [name, region.alias ?? name, ...(extraAliases[region.name] ?? [])];
  if (name.startsWith("республика ")) aliases.push(name.slice("республика ".length));
  if (name.endsWith(" область")) aliases.push(name.replace(/ область$/, " обл"));
  for (const alias of aliases) codesByName.set(normalizeRegion(alias), region.code);
}

export function registryRegionCode(name: string): string {
  const normalized = normalizeRegion(name);
  return codesByName.get(normalized) ?? `stored:${normalized}`;
}
