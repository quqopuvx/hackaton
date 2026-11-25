import type { IncomingMessage, ServerResponse } from "node:http";
import { runAgent } from "../lib/ai/agent.ts";
import { domain } from "../config/domain.ts";
import { addItem, listItems, removeItem, setItemStatus } from "../lib/store.ts";
import type { ChatMessage, Item } from "../lib/types.ts";

interface ApiResult {
  status: number;
  body: unknown;
}

const ok = (body: unknown, status = 200): ApiResult => ({ status, body });
const fail = (error: string, status = 400): ApiResult => ({ status, body: { error } });

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("Слишком большой запрос (лимит 1 MB)");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("Ожидается корректный JSON-объект");
  }
}

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) throw new Error("Поле messages должно быть массивом");
  if (value.length > 40) throw new Error("Слишком много сообщений (максимум 40)");
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`Сообщение #${index} некорректно`);
    const message = raw as Record<string, unknown>;
    if (message.role !== "user" && message.role !== "assistant") {
      throw new Error(`Сообщение #${index}: role должен быть user или assistant`);
    }
    if (typeof message.content !== "string") {
      throw new Error(`Сообщение #${index}: content должен быть строкой`);
    }
    return { role: message.role, content: message.content.slice(0, 8000) };
  });
}

function statusValue(value: unknown): Item["status"] {
  if (value !== "new" && value !== "in_progress" && value !== "done") {
    throw new Error("Статус должен быть new, in_progress или done");
  }
  return value;
}

async function route(req: IncomingMessage, pathname: string): Promise<ApiResult> {
  if (pathname === "/api/health") {
    return ok({ ok: true, provider: process.env.AI_PROVIDER || "mock", caseTitle: domain.caseTitle });
  }

  if (pathname === "/api/agent") {
    if (req.method === "GET") return ok({ provider: process.env.AI_PROVIDER || "mock" });
    if (req.method !== "POST") return fail("Метод не поддерживается", 405);
    const body = await readJson(req);
    return ok(await runAgent(normalizeMessages(body.messages)));
  }

  if (pathname === "/api/items") {
    if (req.method === "GET") return ok({ items: listItems() });

    if (req.method === "POST") {
      const body = await readJson(req);
      if (typeof body.title !== "string") throw new Error("Нужно поле title (строка)");
      return ok({ item: addItem(body.title) }, 201);
    }

    if (req.method === "PATCH" || req.method === "DELETE") {
      const body = await readJson(req);
      if (typeof body.id !== "string" || !body.id) throw new Error("Нужно поле id");
      if (req.method === "DELETE") return ok({ removed: removeItem(body.id) });
      const item = setItemStatus(body.id, statusValue(body.status));
      if (!item) return fail("Сущность не найдена", 404);
      return ok({ item });
    }

    return fail("Метод не поддерживается", 405);
  }

  return fail("Неизвестный endpoint", 404);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

/** Возвращает true, если запрос был обработан как API. */
export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (!pathname.startsWith("/api/")) return false;

  try {
    const result = await route(req, pathname);
    sendJson(res, result.status, result.body);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
  return true;
}
