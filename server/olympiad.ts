import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { olympiad, type SchoolApplicant } from "../lib/olympiad.ts";
import { isSingleEmail } from "../lib/school-mail.ts";

let localDatabase: DatabaseSync | undefined;

export function olympiadDatabase(): DatabaseSync {
  if (localDatabase) return localDatabase;
  const directory = resolve(".olympiad-data");
  mkdirSync(directory, { recursive: true });
  const database = new DatabaseSync(join(directory, "registrations.sqlite"));
  try {
    database.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;");
    database.exec(`
      CREATE TABLE IF NOT EXISTS olympiad_registrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
        email TEXT NOT NULL UNIQUE CHECK (length(email) BETWEEN 1 AND 254),
        consent_version TEXT NOT NULL,
        invitation_opt_in INTEGER NOT NULL CHECK (invitation_opt_in IN (0, 1)),
        registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        school_id TEXT,
        unsubscribed_at TEXT,
        unsubscribe_token TEXT
      );
      CREATE INDEX IF NOT EXISTS olympiad_registrations_invitation_idx
        ON olympiad_registrations (consent_version, id) WHERE invitation_opt_in = 1;
    `);
    const columns = database.prepare("PRAGMA table_info(olympiad_registrations)").all();
    for (const column of ["school_id", "unsubscribed_at", "unsubscribe_token"]) {
      if (!columns.some((existing) => existing.name === column)) {
        database.exec(`ALTER TABLE olympiad_registrations ADD COLUMN ${column} TEXT`);
      }
    }
    database.exec(`
      CREATE INDEX IF NOT EXISTS olympiad_registrations_school_idx ON olympiad_registrations (school_id, id);
      CREATE UNIQUE INDEX IF NOT EXISTS olympiad_unsubscribe_token_idx ON olympiad_registrations (unsubscribe_token);
      CREATE TABLE IF NOT EXISTS applicant_mail_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        delay_days INTEGER NOT NULL CHECK (delay_days IN (7, 14, 30)),
        subject TEXT NOT NULL,
        text TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS applicant_mail_deliveries (
        request_id TEXT PRIMARY KEY,
        applicant_id INTEGER NOT NULL REFERENCES olympiad_registrations(id),
        status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'uncertain', 'skipped'))
      );
      COMMIT;
    `);
  } catch (error) {
    database.close();
    throw error;
  }
  localDatabase = database;
  return database;
}

export function parseOlympiadRegistration(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!name || name.length > 100 || !/\p{L}/u.test(name) || /\p{Cc}/u.test(name)) {
    return { error: "Укажите имя длиной до 100 символов." } as const;
  }
  if (!isSingleEmail(email)) return { error: "Укажите действительный адрес электронной почты." } as const;
  const schoolId = body.schoolId;
  if (typeof schoolId !== "string" || !/^[1-9][0-9]{0,18}$/.test(schoolId) || BigInt(schoolId) > 9223372036854775807n) {
    return { error: "Выберите школу из реестра." } as const;
  }
  if (body.consent !== true || body.consentVersion !== olympiad.consentVersion) {
    return { error: "Подтвердите актуальную версию согласия на обработку данных." } as const;
  }
  if (typeof body.invitationOptIn !== "boolean") {
    return { error: "Укажите, хотите ли вы получать приглашения." } as const;
  }
  return { name, email, schoolId, invitationOptIn: body.invitationOptIn } as const;
}

export function saveOlympiadRegistration(registration: { name: string; email: string; schoolId: string; invitationOptIn: boolean }): void {
  olympiadDatabase().prepare(
    `INSERT INTO olympiad_registrations (name, email, consent_version, invitation_opt_in, school_id)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT (email) DO UPDATE
     SET school_id = excluded.school_id, consent_version = excluded.consent_version
     WHERE olympiad_registrations.school_id IS NULL`,
  ).run(registration.name, registration.email, olympiad.consentVersion, Number(registration.invitationOptIn), registration.schoolId);
}

export function listSchoolApplicants(schoolId: string): SchoolApplicant[] {
  const rows = olympiadDatabase().prepare(
    `SELECT CAST(id AS TEXT) AS id, name, email, (invitation_opt_in = 1 AND unsubscribed_at IS NULL) AS invitationOptIn
     FROM olympiad_registrations WHERE school_id = ? ORDER BY olympiad_registrations.id DESC`,
  ).all(schoolId) as Array<Omit<SchoolApplicant, "invitationOptIn"> & { invitationOptIn: number }>;
  return rows.map((row) => ({ ...row, invitationOptIn: row.invitationOptIn === 1 }));
}

export function allowsOlympiadAgent(authorization: string | undefined): boolean {
  const token = process.env.OLYMPIAD_AGENT_TOKEN;
  if (!token || token.length < 32 || !authorization?.startsWith("Bearer ")) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization.slice(7)), digest(token));
}

export function listOlympiadInvitationContacts(after: string) {
  const rows = olympiadDatabase().prepare(
    `SELECT CAST(id AS TEXT) AS cursor, name, email FROM olympiad_registrations
     WHERE invitation_opt_in = 1 AND unsubscribed_at IS NULL AND id > ? AND consent_version IN ('demo-v1', ?)
     ORDER BY id LIMIT 101`,
  ).all(BigInt(after), olympiad.consentVersion) as { cursor: string; name: string; email: string }[];
  const page = rows.slice(0, 100);
  return {
    consentVersion: olympiad.consentVersion,
    contacts: page.map(({ name, email }) => ({ name, email })),
    nextCursor: page.at(-1)?.cursor ?? after,
    hasMore: rows.length > page.length,
  };
}
