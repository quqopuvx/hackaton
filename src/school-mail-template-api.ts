import type { SavedSchoolMailTemplate } from "../lib/school-mail";
import { apiFetch } from "./session-api";

export async function fetchMailTemplate(id: string, signal: AbortSignal): Promise<SavedSchoolMailTemplate> {
  const response = await apiFetch(`/api/school-mail/templates/${encodeURIComponent(id)}`, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить шаблон.");
  return data.template;
}
