import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request } from "node:https";

interface Token {
  value: string;
  expiresAt: number;
}

let token: Promise<Token> | undefined;

function apiUrl(path: string): string {
  const host = process.env.GIGACHAT_API_HOST || "api.giga.chat";
  if (host !== "api.giga.chat" && host !== "gigachat.devices.sberbank.ru") {
    throw new Error("Укажите официальный адрес GigaChat в GIGACHAT_API_HOST.");
  }
  return `https://${host}/v1/${path}`;
}

async function gigaRequest<T>(url: string, headers: Record<string, string>, body?: string): Promise<T> {
  const certPath = process.env.GIGACHAT_CA_FILE;
  const ca = certPath ? await readFile(certPath, "utf8").catch(() => {
    throw new Error("Не удалось прочитать сертификат GIGACHAT_CA_FILE.");
  }) : undefined;

  return new Promise((resolve, reject) => {
    const host = new URL(url).host;
    let phase = "установление сетевого соединения";
    const req = request(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { Accept: "application/json", "User-Agent": "hackaton-education-registry/1.0", ...headers },
      ...(ca ? { ca } : {}),
      signal: AbortSignal.timeout(url.endsWith("/oauth") ? 20_000 : 65_000),
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`GigaChat API на ${host} вернул HTTP ${status}.`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
        } catch {
          reject(new Error("GigaChat API вернул некорректный JSON."));
        }
      });
    });
    req.on("socket", (socket) => {
      socket.once("connect", () => { phase = "согласование TLS"; });
      socket.once("secureConnect", () => { phase = "ожидание ответа API"; });
    });
    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ABORT_ERR") {
        reject(new Error(`GigaChat не ответил вовремя (${host}, этап: ${phase}).`));
        return;
      }
      reject(new Error(`Не удалось подключиться к ${host} (${error.code ?? "сетевая ошибка"}).`));
    });
    req.end(body);
  });
}

async function authorize(): Promise<Token> {
  const key = process.env.GIGACHAT_AUTH_KEY;
  if (!key) throw new Error("Укажите GIGACHAT_AUTH_KEY в .env.local.");

  const body = new URLSearchParams({ scope: process.env.GIGACHAT_SCOPE || "GIGACHAT_API_PERS" }).toString();
  const result = await gigaRequest<{ access_token?: string; expires_at?: number }>(
    "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    {
      Authorization: `Basic ${key}`,
      RqUID: randomUUID(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  );
  if (!result.access_token || !result.expires_at) throw new Error("GigaChat API не вернул токен доступа.");
  const expiresAt = result.expires_at < 1e12 ? result.expires_at * 1000 : result.expires_at;
  return { value: result.access_token, expiresAt };
}

async function getToken(): Promise<string> {
  const current = token;
  if (current) {
    const saved = await current;
    if (saved.expiresAt > Date.now() + 60_000) return saved.value;
  }
  if (token === current) {
    token = authorize().catch((error: unknown) => {
      token = undefined;
      throw error;
    });
  }
  return (await token!).value;
}

export async function extractWithGigaChat(
  instructions: string,
  input: string,
  schema: object,
): Promise<string> {
  const result = await gigaRequest<{
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  }>(
    apiUrl("chat/completions"),
    { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
    JSON.stringify({
      model: process.env.GIGACHAT_MODEL || "GigaChat-2-Max",
      messages: [{ role: "system", content: instructions }, { role: "user", content: input }],
      response_format: { type: "json_schema", schema, strict: true },
      max_tokens: 3500,
    }),
  );
  const choice = result.choices?.[0];
  if (choice?.finish_reason !== "stop" || !choice.message?.content) {
    throw new Error("GigaChat не завершил обработку результатов поиска.");
  }
  return choice.message.content;
}
