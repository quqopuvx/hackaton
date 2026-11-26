import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import type { Institution, InstitutionDetails, InstitutionEdits } from "./types.ts";
import { schoolMailTemplates } from "./school-mail.ts";
import type { SavedSchoolMailTemplate, SchoolMailHistoryEntry, SchoolMailOutcome, SchoolMailRecipient, SchoolMailReminder, SchoolMailTemplate } from "./school-mail.ts";
import { inferInstitutionType } from "./institution-types.ts";

let ready: Promise<Pool> | undefined;

function database(): Promise<Pool> {
  ready ??= initialize().catch((cause: unknown) => {
    ready = undefined;
    console.error("PostgreSQL:", cause instanceof Error ? cause.message : cause);
    throw new Error("Не удалось подключить реестр. Проверьте DATABASE_URL и доступность PostgreSQL.");
  });
  return ready;
}

async function initialize(): Promise<Pool> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL не задан");

  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  pool.on("error", (error) => console.error("PostgreSQL:", error.message));
  try {
    const schema = await readFile(new URL("../server/schema.sql", import.meta.url), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(53004, 1)");
      await client.query(schema);
      const missing = await client.query<{ id: string; name: string }>(
        "SELECT id::text, name FROM institutions WHERE institution_type IS NULL",
      );
      const classified = missing.rows.flatMap(({ id, name }) => {
        const type = inferInstitutionType(name);
        return type ? [{ id, type }] : [];
      });
      if (classified.length) {
        await client.query(
          `UPDATE institutions AS i SET institution_type = classified.type
           FROM unnest($1::bigint[], $2::text[]) AS classified(id, type)
           WHERE i.id = classified.id AND i.institution_type IS NULL`,
          [classified.map(({ id }) => id), classified.map(({ type }) => type)],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
}

const fields = `id::text, response_status AS "responseStatus",
  COALESCE(manual_edits->>'name', name) AS name,
  COALESCE(manual_edits->>'city', city) AS city,
  COALESCE(manual_edits->>'region', region) AS region,
  CASE WHEN manual_edits ? 'institutionType' THEN manual_edits->>'institutionType' ELSE institution_type END AS "institutionType",
  CASE WHEN manual_edits ? 'leaderName' THEN manual_edits->>'leaderName' ELSE leader_name END AS "leaderName",
  CASE WHEN manual_edits ? 'institutionEmail' THEN manual_edits->>'institutionEmail' ELSE institution_email END AS "institutionEmail",
  CASE WHEN manual_edits ? 'institutionPhone' THEN manual_edits->>'institutionPhone' ELSE institution_phone END AS "institutionPhone",
  COALESCE(manual_edits->'sourceUrls', to_jsonb(source_urls)) AS "sourceUrls",
  CASE WHEN school_enrollment->'identity' = jsonb_build_array(
    COALESCE(manual_edits->>'name', name), COALESCE(manual_edits->>'city', city), COALESCE(manual_edits->>'region', region)
  ) THEN school_enrollment - 'identity' END AS "schoolEnrollment"`;

function enrollmentJson(record: InstitutionDetails): string | null {
  return record.schoolEnrollment
    ? JSON.stringify({ ...record.schoolEnrollment, identity: [record.name, record.city, record.region] })
    : null;
}

export function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export async function listInstitutions(): Promise<Institution[]> {
  const pool = await database();
  const result = await pool.query<Institution>(
    `SELECT ${fields} FROM institutions ORDER BY region, city, name, id`,
  );
  return result.rows;
}

export async function findInstitution(id: string): Promise<Institution | undefined> {
  const pool = await database();
  const result = await pool.query<Institution>(`SELECT ${fields} FROM institutions WHERE id = $1`, [id]);
  return result.rows[0];
}

type DeliveryStatus = Exclude<SchoolMailOutcome["status"], "skipped">;

export async function claimSchoolMail(
  requestId: string, recipient: SchoolMailRecipient, template: string, subject: string,
): Promise<DeliveryStatus | "claimed"> {
  const pool = await database();
  const args = [requestId, recipient.id, recipient.email, template, subject];
  const insert = await pool.query(
    `INSERT INTO school_mail_deliveries (request_id, institution_id, recipient, template, subject, status)
     VALUES ($1, $2, $3, $4, $5, 'sending') ON CONFLICT DO NOTHING`,
    args,
  );
  if (insert.rowCount) return "claimed";
  const previous = await pool.query<{ status: DeliveryStatus }>(
    `SELECT CASE
       WHEN recipient <> $3 OR template <> $4 OR subject <> $5 THEN 'uncertain'
       WHEN status = 'sending' AND created_at < now() - interval '10 minutes' THEN 'uncertain'
       ELSE status END AS status
     FROM school_mail_deliveries WHERE request_id = $1 AND institution_id = $2`,
    args,
  );
  return previous.rows[0]?.status ?? "uncertain";
}

export async function finishSchoolMail(
  requestId: string, id: string, status: Exclude<DeliveryStatus, "sending">, messageId: string | null = null,
): Promise<void> {
  const pool = await database();
  await pool.query(
    `WITH delivery AS (
       UPDATE school_mail_deliveries SET status = $3, message_id = $4, finished_at = now()
       WHERE request_id = $1 AND institution_id = $2 RETURNING institution_id, status
     )
     UPDATE institutions SET response_status = 'awaiting_reply'
     FROM delivery WHERE id = delivery.institution_id AND delivery.status = 'sent' AND response_status = 'not_sent'`,
    [requestId, id, status, messageId],
  );
}

export interface SentSchoolMail {
  schoolId: string;
  schoolName: string;
  recipient: string;
  template: string;
  subject: string | null;
  messageId: string | null;
  sentAt: Date;
}

export async function listSentSchoolMail(since: Date): Promise<SentSchoolMail[]> {
  const pool = await database();
  const { rows } = await pool.query<SentSchoolMail>(
    `SELECT d.institution_id::text AS "schoolId", COALESCE(i.manual_edits->>'name', i.name) AS "schoolName",
       d.recipient, d.template, d.subject, d.message_id AS "messageId",
       date_trunc('second', COALESCE(d.finished_at, d.created_at)) AS "sentAt"
     FROM school_mail_deliveries d JOIN institutions i ON i.id = d.institution_id
     WHERE d.status = 'sent' AND COALESCE(d.finished_at, d.created_at) >= $1 ORDER BY "sentAt" DESC`,
    [since],
  );
  return rows;
}

export async function listSchoolMailHistory(page: number): Promise<{ entries: SchoolMailHistoryEntry[]; hasMore: boolean }> {
  const pool = await database();
  const pageSize = 50;
  const { rows } = await pool.query<Omit<SchoolMailHistoryEntry, "subject"> & { subject: string | null; template: string }>(
    `SELECT d.request_id::text || ':' || d.institution_id::text AS id, d.institution_id::text AS "schoolId",
       COALESCE(i.manual_edits->>'name', i.name) AS "schoolName", d.recipient, d.subject, d.template,
       CASE WHEN d.status = 'sending' AND d.created_at < now() - interval '10 minutes'
         THEN 'uncertain' ELSE d.status END AS status, COALESCE(d.finished_at, d.created_at) AS date
     FROM school_mail_deliveries d JOIN institutions i ON i.id = d.institution_id
     ORDER BY date DESC, d.request_id DESC, d.institution_id DESC LIMIT $1 OFFSET $2`,
    [pageSize + 1, (page - 1) * pageSize],
  );
  const entries = rows.slice(0, pageSize).map(({ template, subject, ...row }) =>
    ({ ...row, subject: subject ?? schoolMailTemplates[template as SchoolMailTemplate] ?? "Без темы" }));
  return { entries, hasMore: rows.length > pageSize };
}

export async function listSchoolMailReminders(days: number): Promise<SchoolMailReminder[]> {
  const pool = await database();
  const { rows } = await pool.query<SchoolMailReminder>(
    `SELECT i.id::text AS "schoolId", COALESCE(i.manual_edits->>'name', i.name) AS "schoolName",
       CASE WHEN i.manual_edits ? 'institutionEmail' THEN i.manual_edits->>'institutionEmail' ELSE i.institution_email END AS email,
       latest.sent_at AS "lastSentAt"
     FROM institutions i
     JOIN LATERAL (
       SELECT COALESCE(d.finished_at, d.created_at) AS sent_at FROM school_mail_deliveries d
       WHERE d.institution_id = i.id AND d.status = 'sent'
       ORDER BY sent_at DESC LIMIT 1
     ) latest ON true
     WHERE i.response_status = 'awaiting_reply'
       AND (CASE WHEN i.manual_edits ? 'institutionType' THEN i.manual_edits->>'institutionType' ELSE i.institution_type END) = 'school'
       AND latest.sent_at <= now() - $1 * interval '1 day'
     ORDER BY latest.sent_at, i.id`,
    [days],
  );
  return rows;
}

export async function listSchoolMailTemplates(): Promise<SavedSchoolMailTemplate[]> {
  const pool = await database();
  return (await pool.query<SavedSchoolMailTemplate>("SELECT id, name, subject, text FROM school_mail_templates ORDER BY name, id")).rows;
}

export async function findSchoolMailTemplate(id: string): Promise<SavedSchoolMailTemplate | undefined> {
  const pool = await database();
  return (await pool.query<SavedSchoolMailTemplate>("SELECT id, name, subject, text FROM school_mail_templates WHERE id = $1", [id])).rows[0];
}

export async function saveSchoolMailTemplate(template: SavedSchoolMailTemplate, update: boolean): Promise<SavedSchoolMailTemplate | undefined> {
  const pool = await database();
  const sql = update
    ? "UPDATE school_mail_templates SET name = $2, subject = $3, text = $4 WHERE id = $1 RETURNING id, name, subject, text"
    : "INSERT INTO school_mail_templates (id, name, subject, text) VALUES ($1, $2, $3, $4) RETURNING id, name, subject, text";
  return (await pool.query<SavedSchoolMailTemplate>(sql, [template.id, template.name, template.subject, template.text])).rows[0];
}

export async function markSchoolsReplied(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const pool = await database();
  await pool.query(
    `UPDATE institutions SET response_status = 'replied'
     WHERE id = ANY($1::bigint[]) AND response_status = 'awaiting_reply'`,
    [ids],
  );
}

export async function applyInstitutionRefresh(
  original: Institution, verified: InstitutionDetails,
): Promise<Institution | undefined> {
  const pool = await database();
  const result = await pool.query<Institution>(
    `UPDATE institutions SET
       leader_name = COALESCE($2, leader_name),
       institution_email = COALESCE($3, institution_email),
       institution_phone = COALESCE($4, institution_phone),
       school_enrollment = COALESCE($9::jsonb, school_enrollment),
       source_urls = ARRAY(
         SELECT url FROM unnest($5::text[] || source_urls) WITH ORDINALITY AS source(url, position)
         GROUP BY url ORDER BY min(position)
       )
     WHERE id = $1
       AND COALESCE(manual_edits->>'name', name) = $6
       AND COALESCE(manual_edits->>'city', city) = $7
       AND COALESCE(manual_edits->>'region', region) = $8
     RETURNING ${fields}`,
    [original.id, verified.leaderName, verified.institutionEmail, verified.institutionPhone, verified.sourceUrls,
      original.name, original.city, original.region, enrollmentJson(verified)],
  );
  return result.rows[0];
}

export async function updateInstitution(id: string, edits: InstitutionEdits): Promise<Institution | undefined> {
  const pool = await database();
  const result = await pool.query<Institution>(
    `UPDATE institutions SET manual_edits = manual_edits || $2::jsonb
     WHERE id = $1 RETURNING ${fields}`,
    [id, JSON.stringify(edits)],
  );
  return result.rows[0];
}

export async function findSavedSearch(queryKey: string): Promise<Institution[] | null> {
  const pool = await database();
  const result = await pool.query<Institution>(
    `SELECT ${fields} FROM institution_searches s
      JOIN LATERAL unnest(s.institution_ids) WITH ORDINALITY AS hit(institution_id, position) ON true
      JOIN institutions i ON i.id = hit.institution_id
      WHERE s.query_key = $1 ORDER BY hit.position`,
    [queryKey],
  );
  return result.rows.length ? result.rows : null;
}

async function upsert(client: PoolClient, record: InstitutionDetails): Promise<Institution> {
  const key = JSON.stringify([record.name, record.city, record.region].map(normalize));
  const result = await client.query<Institution>(
    `INSERT INTO institutions
       (identity_key, name, city, region, leader_name, institution_email, institution_phone, source_urls, institution_type, school_enrollment)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (identity_key) DO UPDATE SET
       institution_type = COALESCE(EXCLUDED.institution_type, institutions.institution_type),
       leader_name = COALESCE(EXCLUDED.leader_name, institutions.leader_name),
       institution_email = COALESCE(EXCLUDED.institution_email, institutions.institution_email),
       institution_phone = COALESCE(EXCLUDED.institution_phone, institutions.institution_phone),
       school_enrollment = CASE WHEN EXCLUDED.school_enrollment->'identity' = jsonb_build_array(
         COALESCE(institutions.manual_edits->>'name', institutions.name),
         COALESCE(institutions.manual_edits->>'city', institutions.city),
         COALESCE(institutions.manual_edits->>'region', institutions.region)
       ) THEN EXCLUDED.school_enrollment
         WHEN COALESCE(institutions.manual_edits->>'name', institutions.name) = institutions.name
           AND COALESCE(institutions.manual_edits->>'city', institutions.city) = institutions.city
           AND COALESCE(institutions.manual_edits->>'region', institutions.region) = institutions.region
           THEN COALESCE(jsonb_set(EXCLUDED.school_enrollment, '{identity}',
             jsonb_build_array(institutions.name, institutions.city, institutions.region)), institutions.school_enrollment)
         ELSE institutions.school_enrollment END,
       source_urls = ARRAY(SELECT DISTINCT url FROM
         unnest(institutions.source_urls || EXCLUDED.source_urls) AS source(url) ORDER BY url)
     RETURNING ${fields}`,
    [key, record.name, record.city, record.region, record.leaderName, record.institutionEmail,
      record.institutionPhone, record.sourceUrls, record.institutionType, enrollmentJson(record)],
  );
  return result.rows[0];
}

export async function saveSearch(queryKey: string, records: InstitutionDetails[], cache = true): Promise<Institution[]> {
  if (!records.length) return [];

  const pool = await database();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const saved = new Map<string, Institution>();
    const ordered = [...records].sort((a, b) =>
      normalize(a.name).localeCompare(normalize(b.name)) ||
      normalize(a.city).localeCompare(normalize(b.city)) ||
      normalize(a.region).localeCompare(normalize(b.region)),
    );
    for (const record of ordered) {
      const institution = await upsert(client, record);
      saved.set(institution.id, institution);
    }
    if (cache) {
      await client.query(
        `INSERT INTO institution_searches (query_key, institution_ids) VALUES ($1, $2)
         ON CONFLICT (query_key) DO NOTHING`,
        [queryKey, [...saved.keys()]],
      );
    }
    await client.query("COMMIT");
    return [...saved.values()];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
