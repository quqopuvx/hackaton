import { apiFetch } from "./session-api";
import type { SchoolReply } from "../lib/school-mail";

export async function fetchSchoolReplies(): Promise<SchoolReply[]> {
  const response = await apiFetch("/api/school-mail/replies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(50_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить ответы.");
  return data.replies;
}
