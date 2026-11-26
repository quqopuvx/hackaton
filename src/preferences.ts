import { isSingleEmail } from "../lib/school-mail";

export const reminderIntervals = [7, 14, 30] as const;
export type ReminderInterval = typeof reminderIntervals[number];
export const notificationLabels = {
  reply: "Новые ответы",
  sendError: "Проблемы с отправкой",
  completed: "Завершение рассылки",
} as const;
export type NotificationKind = keyof typeof notificationLabels;

export interface Preferences {
  theme: "light" | "dark" | "system";
  signature: string;
  replyTo: string;
  defaultTemplate: string;
  defaultRegion: string;
  rememberFilters: boolean;
  reminderDays: ReminderInterval;
  excludeReplied: boolean;
  notifications: Record<NotificationKind, boolean>;
}

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  text: string;
  date: string;
}

export function readBrowserValue<T>(key: string): T | undefined {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveBrowserValue(key: string, value: unknown): boolean {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const signatureLimit = 500;

export function readPreferences(key: string): Preferences {
  const saved = readBrowserValue<Partial<Preferences>>(key);
  const days = saved?.reminderDays ?? 7;
  return {
    theme: saved?.theme === "dark" || saved?.theme === "system" ? saved.theme : "light",
    signature: typeof saved?.signature === "string" ? saved.signature.slice(0, signatureLimit) : "",
    replyTo: typeof saved?.replyTo === "string" && isSingleEmail(saved.replyTo) ? saved.replyTo : "",
    defaultTemplate: typeof saved?.defaultTemplate === "string" ? saved.defaultTemplate : "",
    defaultRegion: typeof saved?.defaultRegion === "string" ? saved.defaultRegion : "",
    rememberFilters: saved?.rememberFilters === true,
    reminderDays: reminderIntervals.includes(days) ? days : 7,
    excludeReplied: saved?.excludeReplied !== false,
    notifications: {
      reply: saved?.notifications?.reply !== false,
      sendError: saved?.notifications?.sendError !== false,
      completed: saved?.notifications?.completed !== false,
    },
  };
}
