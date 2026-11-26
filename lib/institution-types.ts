export const institutionTypeLabels = {
  university: "Вуз",
  college: "Колледж / СПО",
  school: "Школа",
  kindergarten: "Детский сад",
  supplementary: "Дополнительное образование",
  other: "Другое",
} as const;

export type InstitutionType = keyof typeof institutionTypeLabels;

export function inferInstitutionType(name: string): InstitutionType | null {
  const text = name.toLocaleLowerCase("ru").replace(/ё/g, "е");
  if (/(?:^|[^\p{L}])(?:колледж|техникум)(?!\p{L})/u.test(text)) return "college";
  if (/(?:^|[^\p{L}])детский[\s-]+сад(?!\p{L})/u.test(text)) return "kindergarten";
  if (/(?:музыкальная|художественная|спортивная) школа|школа искусств|дополнительного образования/u.test(text)) {
    return "supplementary";
  }
  if (/(?:^|[^\p{L}])университет(?!\p{L})/u.test(text)) return "university";
  if (/(?:^|[^\p{L}])(?:школа|гимназия|лицей|сош|оош|нош)(?!\p{L})/u.test(text) &&
    !/(?:высшая школа|профессиональный лицей)/u.test(text)) return "school";
  return null;
}

export function readInstitutionType(value: unknown, name: string): InstitutionType | null {
  if (typeof value === "string" && Object.hasOwn(institutionTypeLabels, value)) return value as InstitutionType;
  return inferInstitutionType(name);
}

