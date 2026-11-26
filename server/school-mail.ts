import { createHash, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { isSingleEmail, personalizeSchoolMail } from "../lib/school-mail.ts";
import type { SchoolMailOutcome, SchoolMailRecipient } from "../lib/school-mail.ts";
import { claimSchoolMail, findInstitution, finishSchoolMail } from "../lib/store.ts";

function smtpConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM?.trim();
  const accessCode = process.env.MAIL_ACCESS_CODE;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !user || !pass || !from || !isSingleEmail(from) || !accessCode || accessCode.length < 16) return;
  return { host, port, user, pass, from, accessCode };
}

export function authorizeSchoolMail(code: string): "unconfigured" | "denied" | "allowed" {
  const config = smtpConfig();
  if (!config) return "unconfigured";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(code), digest(config.accessCode)) ? "allowed" : "denied";
}

export async function sendSchoolMail(
  requestId: string, template: string, recipients: SchoolMailRecipient[], message: { subject: string; text: string },
): Promise<SchoolMailOutcome[]> {
  const config = smtpConfig();
  if (!config) throw new Error("Отправка писем ещё не настроена.");
  const from = { name: "МеркурИИй", address: config.from };
  const transport = nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.port === 465, requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.pass }, pool: true, maxConnections: 3,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });

  async function deliver(recipient: SchoolMailRecipient): Promise<SchoolMailOutcome> {
    const { id, email } = recipient;
    const school = await findInstitution(id);
    if (school?.institutionType !== "school" || school.institutionEmail?.trim() !== email) {
      return { id, status: "skipped", message: "Карточка школы или адрес изменились. Обновите реестр." };
    }
    const claimed = await claimSchoolMail(requestId, recipient, template, message.subject);
    if (claimed !== "claimed") return { id, status: claimed };

    let status: "sent" | "failed" | "uncertain";
    let messageId: string | null = null;
    try {
      const info = await transport.sendMail({
        from,
        to: { name: school.name, address: email },
        subject: message.subject,
        text: personalizeSchoolMail(message.text, school.name),
      });
      status = info.accepted.length ? "sent" : "failed";
      if (status === "sent") messageId = info.messageId || null;
    } catch (error) {
      const responseCode = (error as { responseCode?: number } | null)?.responseCode;
      status = responseCode && responseCode >= 400 ? "failed" : "uncertain";
    }
    await finishSchoolMail(requestId, id, status, messageId);
    return { id, status };
  }

  try {
    const results = await Promise.allSettled(recipients.map(deliver));
    return results.map((result, index) => {
      if (result.status === "fulfilled") return result.value;
      console.error("Не удалось сохранить результат отправки:", result.reason);
      return { id: recipients[index].id, status: "uncertain" };
    });
  } finally {
    transport.close();
  }
}
