import type { Account } from "../lib/accounts";

export const sessionExpiredEvent = "mercury:session-expired";
let sessionVersion = 0;

export async function apiFetch(input: string, options?: RequestInit): Promise<Response> {
  const version = sessionVersion;
  const response = await fetch(input, options);
  if (response.status === 401 && version === sessionVersion) {
    sessionVersion++;
    window.dispatchEvent(new Event(sessionExpiredEvent));
  }
  return response;
}

async function requestSession(path: string, body?: Record<string, string>): Promise<{ user?: Account }> {
  const response = await fetch(`/api/auth/${path}`, body && {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Не удалось связаться с сервером.");
  return data;
}

export function getSession(): Promise<{ user?: Account }> {
  return requestSession("session");
}

export async function logIn(username: string, password: string): Promise<Account> {
  const { user } = await requestSession("login", { username, password });
  if (!user) throw new Error("Не удалось войти в аккаунт.");
  sessionVersion++;
  return user;
}

export async function logOut(): Promise<void> {
  await requestSession("logout", {});
  sessionVersion++;
}
