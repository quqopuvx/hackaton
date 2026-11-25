import type { Item } from "./types.ts";

/**
 * Демо-хранилище в памяти процесса.
 * На хакатоне можно заменить на Supabase/Neon, не меняя интерфейс функций.
 */
const items = new Map<string, Item>();
let seeded = false;

function seed(): void {
  if (seeded) return;
  seeded = true;
  const now = new Date().toISOString();
  const demo: Array<[string, Item["status"]]> = [
    ["Проверить гипотезу проблемы", "done"],
    ["Собрать 3 сценария использования", "in_progress"],
    ["Подготовить демо-скрипт для жюри", "new"],
  ];
  for (const [title, status] of demo) {
    const id = crypto.randomUUID();
    items.set(id, { id, title, status, createdAt: now });
  }
}

export function listItems(): Item[] {
  seed();
  return [...items.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function addItem(rawTitle: string): Item {
  seed();
  const title = rawTitle.trim().slice(0, 160);
  if (!title) throw new Error("Заголовок не может быть пустым");
  const item: Item = {
    id: crypto.randomUUID(),
    title,
    status: "new",
    createdAt: new Date().toISOString(),
  };
  items.set(item.id, item);
  return item;
}

export function setItemStatus(id: string, status: Item["status"]): Item | null {
  seed();
  const item = items.get(id);
  if (!item) return null;
  const updated: Item = { ...item, status };
  items.set(id, updated);
  return updated;
}

export function removeItem(id: string): boolean {
  seed();
  return items.delete(id);
}
