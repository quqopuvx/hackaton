import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import type { Institution, InstitutionDetails, InstitutionEdits } from "./types.ts";
import type { SchoolMailOutcome, SchoolMailRecipient, SchoolMailTemplate } from "./school-mail.ts";
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
  COALESCE(manual_edits->'sourceUrls', to_jsonb(source_urls)) AS "sourceUrls"`;

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
  requestId: string, recipient: SchoolMailRecipient, template: SchoolMailTemplate,
): Promise<DeliveryStatus | "claimed"> {
  const pool = await database();
  const args = [requestId, recipient.id, recipient.email, template];
  const insert = await pool.query(
    `INSERT INTO school_mail_deliveries (request_id, institution_id, recipient, template, status)
     VALUES ($1, $2, $3, $4, 'sending') ON CONFLICT DO NOTHING`,
    args,
  );
  if (insert.rowCount) return "claimed";
  const previous = await pool.query<{ status: DeliveryStatus }>(
    `SELECT CASE
       WHEN recipient <> $3 OR template <> $4 THEN 'uncertain'
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
       UPDATE school_mail_deliveries SET status = $3, message_id = $4
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
  template: SchoolMailTemplate;
  messageId: string | null;
  sentAt: Date;
}

export async function listSentSchoolMail(since: Date): Promise<SentSchoolMail[]> {
  const pool = await database();
  const { rows } = await pool.query<SentSchoolMail>(
    `SELECT d.institution_id::text AS "schoolId", COALESCE(i.manual_edits->>'name', i.name) AS "schoolName",
       d.recipient, d.template, d.message_id AS "messageId", d.created_at AS "sentAt"
     FROM school_mail_deliveries d JOIN institutions i ON i.id = d.institution_id
     WHERE d.status = 'sent' AND d.created_at >= $1 ORDER BY d.created_at DESC`,
    [since],
  );
  return rows;
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
      original.name, original.city, original.region],
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
       (identity_key, name, city, region, leader_name, institution_email, institution_phone, source_urls, institution_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (identity_key) DO UPDATE SET
       institution_type = COALESCE(EXCLUDED.institution_type, institutions.institution_type),
       leader_name = COALESCE(EXCLUDED.leader_name, institutions.leader_name),
       institution_email = COALESCE(EXCLUDED.institution_email, institutions.institution_email),
       institution_phone = COALESCE(EXCLUDED.institution_phone, institutions.institution_phone),
       source_urls = ARRAY(SELECT DISTINCT url FROM
         unnest(institutions.source_urls || EXCLUDED.source_urls) AS source(url) ORDER BY url)
     RETURNING ${fields}`,
    [key, record.name, record.city, record.region, record.leaderName, record.institutionEmail,
      record.institutionPhone, record.sourceUrls, record.institutionType],
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
