import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { applicantUnsubscribeLabel, olympiad, type ApplicantMailRecipient, type ApplicantMailSettings } from "../lib/olympiad.ts";
import { escapeHtml } from "../lib/school-mail-design-html.ts";
import { createMailTransport, mailConfigured } from "./mail-transport.ts";
import { olympiadDatabase } from "./olympiad.ts";

type DeliveryStatus = "sending" | "sent" | "failed" | "uncertain" | "skipped";
type Message = Pick<ApplicantMailSettings, "subject" | "text">;
const eligible = "invitation_opt_in = 1 AND unsubscribed_at IS NULL AND consent_version IN ('demo-v1', ?)";
const unsubscribePrefix = "/api/olympiad/unsubscribe/";
const defaultSettings: ApplicantMailSettings = { enabled: false, delayDays: 7, subject: "", text: "" };

export function listApplicantMailRecipients(): ApplicantMailRecipient[] {
  return olympiadDatabase().prepare(`SELECT CAST(id AS TEXT) AS id, name, email FROM olympiad_registrations
    WHERE ${eligible} ORDER BY name, email`).all(olympiad.consentVersion) as ApplicantMailRecipient[];
}

function applicantMailOrigin(): string | undefined {
  const value = process.env.APPLICANT_MAIL_ORIGIN?.trim() || process.env.APP_ORIGIN?.trim();
  if (!value || !URL.canParse(value)) return;
  const url = new URL(value);
  if (url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash) {
    return url.origin;
  }
}

export function applicantMailSetupError(): string | undefined {
  if (!applicantMailOrigin() || !mailConfigured()) return "Отправка писем недоступна.";
}

export function getApplicantMailSettings(): ApplicantMailSettings {
  const row = olympiadDatabase().prepare(
    "SELECT enabled, delay_days AS delayDays, subject, text FROM applicant_mail_settings WHERE id = 1",
  ).get() as (Omit<ApplicantMailSettings, "enabled"> & { enabled: number }) | undefined;
  return row ? { ...row, enabled: row.enabled === 1 } : { ...defaultSettings };
}

export function saveApplicantMailSettings(settings: ApplicantMailSettings): void {
  olympiadDatabase().prepare(`INSERT INTO applicant_mail_settings (id, enabled, delay_days, subject, text)
    VALUES (1, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET
    enabled = excluded.enabled, delay_days = excluded.delay_days, subject = excluded.subject, text = excluded.text`,
  ).run(Number(settings.enabled), settings.delayDays, settings.subject, settings.text);
}

export async function sendApplicantMail(requestId: string, applicantId: string, message: Message): Promise<DeliveryStatus> {
  const origin = applicantMailOrigin();
  if (!origin) throw new Error("Адрес для отписки ещё не настроен.");
  const database = olympiadDatabase();
  const getDelivery = () => database.prepare("SELECT status FROM applicant_mail_deliveries WHERE request_id = ? AND applicant_id = ?")
    .get(requestId, applicantId) as { status: DeliveryStatus } | undefined;
  const existing = getDelivery();
  if (existing) return existing.status;
  const applicant = database.prepare(`UPDATE olympiad_registrations
    SET unsubscribe_token = COALESCE(unsubscribe_token, ?) WHERE id = ? AND ${eligible}
    RETURNING name, email, unsubscribe_token AS token`,
  ).get(randomBytes(32).toString("base64url"), applicantId, olympiad.consentVersion) as
    { name: string; email: string; token: string } | undefined;
  if (!applicant) return "skipped";

  const { from, transport } = createMailTransport();
  try {
    const claimed = database.prepare(`INSERT INTO applicant_mail_deliveries (request_id, applicant_id, status)
      SELECT ?, id, 'sending' FROM olympiad_registrations WHERE id = ? AND ${eligible}
      ON CONFLICT (request_id) DO NOTHING`,
    ).run(requestId, applicantId, olympiad.consentVersion);
    if (!claimed.changes) return getDelivery()?.status ?? "skipped";

    const unsubscribe = new URL(unsubscribePrefix + applicant.token, origin).href;
    const text = message.text.replaceAll("{{имя}}", () => applicant.name);
    let status: DeliveryStatus;
    try {
      const info = await transport.sendMail({
        from,
        to: { name: applicant.name, address: applicant.email },
        subject: message.subject,
        text: `${text}\n\n${applicantUnsubscribeLabel}: ${unsubscribe}`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6"><p>${escapeHtml(text).replace(/\r\n?|\n/g, "<br>")}</p>
          <p><a style="display:inline-block;padding:10px 16px;background:#5d3d65;border-radius:24px;color:#fff;text-decoration:none"
            href="${escapeHtml(unsubscribe)}">${applicantUnsubscribeLabel}</a></p></div>`,
        headers: { "List-Unsubscribe": `<${unsubscribe}>` },
      });
      status = info.accepted.length ? "sent" : "failed";
    } catch (error) {
      const code = (error as { responseCode?: number } | null)?.responseCode;
      status = code && code >= 400 ? "failed" : "uncertain";
    }
    database.prepare("UPDATE applicant_mail_deliveries SET status = ? WHERE request_id = ?").run(status, requestId);
    return status;
  } finally {
    transport.close();
  }
}

export function handleApplicantUnsubscribe(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if (!pathname.startsWith(unsubscribePrefix)) return false;
  const token = pathname.slice(unsubscribePrefix.length);
  let status = 200;
  let title = applicantUnsubscribeLabel;
  let content = '<form method="post"><p>Подтвердите отказ от приглашений поступить в вуз.</p><button>Отказаться от рассылки</button></form>';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    status = 404;
    title = "Ссылка недействительна";
    content = "<p>Откройте ссылку из письма.</p>";
  } else if (req.method === "POST") {
    const site = req.headers["sec-fetch-site"];
    if (site && site !== "same-origin" && site !== "none") {
      status = 403;
      content = "<p>Откройте ссылку из письма и подтвердите отказ на этой странице.</p>";
    } else {
      try {
        const result = olympiadDatabase().prepare(`UPDATE olympiad_registrations SET unsubscribed_at = COALESCE(unsubscribed_at, CURRENT_TIMESTAMP)
          WHERE unsubscribe_token = ?`).run(token);
        if (result.changes) {
          title = "Вы отписались от рассылки";
          content = "<p>Приглашения на этот адрес больше отправляться не будут.</p>";
        } else {
          status = 404;
          title = "Ссылка недействительна";
          content = "<p>Откройте ссылку из письма.</p>";
        }
      } catch {
        status = 503;
        content = "<p>Не удалось сохранить отказ. Попробуйте ещё раз.</p>" + content;
      }
    }
  } else if (req.method !== "GET") {
    status = 405;
    res.setHeader("Allow", "GET, POST");
    content = "<p>Откройте ссылку из письма.</p>";
  }
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff" });
  res.end(`<!doctype html><html lang="ru"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title} — МеркурИИй</title><style>body{font:1rem/1.6 system-ui;background:#f2f1f2;color:#211d22;margin:1rem}main{max-width:34rem;margin:10vh auto;padding:1.5rem;background:white;border:1px solid #ddd8df;border-radius:1.5rem}h1{line-height:1.25}button{font:inherit;background:#5d3d65;color:white;border:0;border-radius:2rem;padding:.65rem 1rem;cursor:pointer}</style>
    <main><h1>${title}</h1>${content}</main></html>`);
  return true;
}

export async function runAutomaticApplicantMail(): Promise<void> {
  if (applicantMailSetupError()) return;
  const settings = getApplicantMailSettings();
  if (!settings.enabled) return;
  const due = olympiadDatabase().prepare(`SELECT CAST(id AS TEXT) AS id FROM olympiad_registrations r
    WHERE school_id IS NOT NULL AND ${eligible} AND registered_at <= datetime('now', ?)
      AND NOT EXISTS (SELECT 1 FROM applicant_mail_deliveries d WHERE d.request_id = 'automatic:' || r.id)
    ORDER BY r.id LIMIT 10`,
  ).all(olympiad.consentVersion, `-${settings.delayDays} days`) as { id: string }[];
  for (const { id } of due) {
    const current = getApplicantMailSettings();
    if (!current.enabled || current.delayDays !== settings.delayDays) break;
    await sendApplicantMail(`automatic:${id}`, id, current);
  }
}

export function startApplicantMailScheduler(): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runAutomaticApplicantMail().catch(() => console.error("Не удалось обработать авторассылку абитуриентам."))
      .finally(() => { running = false; });
  }, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
