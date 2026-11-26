import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { TLSSocket } from "node:tls";
import type { Account, AuditAction, AuditEntry } from "../lib/accounts.ts";
import { database } from "../lib/store.ts";

const scryptOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const cookieName = "mercury_session";
const sessionSeconds = 8 * 60 * 60;
const dummyHash = "0".repeat(32) + ":" + "0".repeat(128);
const attemptWindowMs = 5 * 60_000;
const attempts = new Map<string, { count: number; expires: number }>();
let pendingLogins = 0;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, scryptOptions, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return salt.toString("hex") + ":" + key.toString("hex");
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(":");
  if (!/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{128}$/.test(key)) return false;
  return timingSafeEqual(await deriveKey(password, Buffer.from(salt, "hex")), Buffer.from(key, "hex"));
}

function sessionHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenFrom(req: IncomingMessage): string | undefined {
  const cookie = req.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(cookieName + "="));
  const token = cookie?.slice(cookieName.length + 1);
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) return token;
}

function secureRequest(req: IncomingMessage): boolean {
  return req.socket instanceof TLSSocket || process.env.APP_ORIGIN?.startsWith("https://") === true;
}

export function allowsRequestOrigin(req: IncomingMessage): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return true;
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  const expected = process.env.APP_ORIGIN || `${secureRequest(req) ? "https" : "http"}://${req.headers.host}`;
  return origin === expected;
}

export function setSessionCookie(req: IncomingMessage, res: ServerResponse, token = ""): void {
  const secure = secureRequest(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? sessionSeconds : 0}${secure}`);
}

export async function readSession(req: IncomingMessage): Promise<Account | undefined> {
  const token = tokenFrom(req);
  if (!token) return;
  const pool = await database();
  const { rows } = await pool.query<Account>(
    `UPDATE app_sessions s SET last_seen_at = now()
     FROM app_users u
     WHERE s.token_hash = $1 AND s.username = u.username
       AND s.expires_at > now() AND s.last_seen_at > now() - interval '45 minutes'
     RETURNING u.username, u.display_name AS name, u.role`,
    [sessionHash(token)],
  );
  return rows[0];
}

function takeLoginAttempt(req: IncomingMessage): boolean {
  const now = Date.now();
  if (pendingLogins >= 3) return false;
  const address = req.socket.remoteAddress ?? "unknown";
  for (const [key, attempt] of attempts) if (attempt.expires <= now) attempts.delete(key);
  const current = attempts.get(address);
  if (current) {
    if (current.count >= 12) return false;
    current.count++;
  } else {
    if (attempts.size >= 2000) return false;
    attempts.set(address, { count: 1, expires: now + attemptWindowMs });
  }
  return true;
}

export async function signIn(req: IncomingMessage, username: string, password: string): Promise<
  { user: Account; token: string } | "denied" | "throttled"
> {
  if (!takeLoginAttempt(req)) return "throttled";
  pendingLogins++;
  try {
    const pool = await database();
    const { rows: [row] } = await pool.query<Account & { passwordHash: string }>(
      `SELECT username, display_name AS name, role, password_hash AS "passwordHash"
       FROM app_users WHERE username = $1`, [username],
    );
    if (!(await verifyPassword(password, row?.passwordHash ?? dummyHash)) || !row) return "denied";

    const { passwordHash, ...user } = row;
    const token = randomBytes(32).toString("base64url");
    const previous = tokenFrom(req);
    await pool.query(
      `WITH revoked AS (
         DELETE FROM app_sessions WHERE token_hash = $3 OR expires_at <= now()
           OR last_seen_at <= now() - interval '45 minutes'
       ), session AS (
         INSERT INTO app_sessions (token_hash, username, expires_at)
         SELECT $1, username, now() + $4::int * interval '1 second' FROM app_users
         WHERE username = $2 AND password_hash = $5 RETURNING username
       )
       INSERT INTO app_audit_events (username, display_name, role, action)
       SELECT u.username, u.display_name, u.role, 'login' FROM session s JOIN app_users u USING (username)`,
      [sessionHash(token), user.username, previous ? sessionHash(previous) : null, sessionSeconds, passwordHash],
    ).then((result) => {
      if (result.rowCount !== 1) throw new Error("Аккаунт изменился. Повторите вход.");
    });
    return { user, token };
  } finally {
    pendingLogins--;
  }
}

export async function signOut(req: IncomingMessage): Promise<void> {
  const token = tokenFrom(req);
  if (!token) return;
  const pool = await database();
  await pool.query(
    `WITH revoked AS (DELETE FROM app_sessions WHERE token_hash = $1 RETURNING username)
     INSERT INTO app_audit_events (username, display_name, role, action)
     SELECT u.username, u.display_name, u.role, 'logout' FROM revoked r JOIN app_users u USING (username)`,
    [sessionHash(token)],
  );
}

export async function recordAudit(user: Account, action: AuditAction, details: string | null = null): Promise<void> {
  try {
    const pool = await database();
    await pool.query(
      `INSERT INTO app_audit_events (username, display_name, role, action, details) VALUES ($1, $2, $3, $4, $5)`,
      [user.username, user.name, user.role, action, details],
    );
  } catch (error) {
    console.error("Не удалось записать событие аудита:", action, error instanceof Error ? error.message : error);
  }
}

export async function readAudit(): Promise<AuditEntry[]> {
  const pool = await database();
  const { rows } = await pool.query<AuditEntry>(
    `SELECT id::text, username, display_name AS name, role, action, details, occurred_at AS "occurredAt"
     FROM app_audit_events ORDER BY id DESC LIMIT 100`,
  );
  return rows;
}
