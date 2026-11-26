import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { isSingleEmail, personalizeSchoolMail } from "../lib/school-mail.ts";
import type { SchoolMailLayout, SchoolMailOutcome, SchoolMailRecipient } from "../lib/school-mail.ts";
import { renderSchoolMailHtml } from "../lib/school-mail-html.ts";
import { renderDesignedMail } from "../lib/school-mail-design-html.ts";
import { mailDesignText, type MailImage, type SchoolMailDesign } from "../lib/school-mail-design.ts";
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
  requestId: string, template: string, recipients: SchoolMailRecipient[],
  message: { subject: string; text: string; layout: SchoolMailLayout; replyTo?: string; design?: SchoolMailDesign | null; signature?: string },
  campaignId: string | null = null,
): Promise<SchoolMailOutcome[]> {
  const config = smtpConfig();
  if (!config) throw new Error("Отправка писем ещё не настроена.");
  const from = { name: "МеркурИИй", address: config.from };
  const transport = nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.port === 465, requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.pass }, pool: true, maxConnections: 3,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    disableFileAccess: true, disableUrlAccess: true,
  });

  const { design } = message;
  const images = new Map<string, { cid: string; content: Buffer; contentType: string }>();
  function addImage(image: MailImage, key: string): void {
    images.set(key, {
      cid: randomUUID() + "@mercury.local", content: Buffer.from(image.data, "base64"), contentType: image.mime,
    });
  }
  if (design?.background) addImage(design.background, "background");
  design?.blocks.forEach((block, index) => { if (block.type === "image") addImage(block.image, String(index)); });
  const attachments = images.size ? [...images.values()] : undefined;

  async function deliver(recipient: SchoolMailRecipient): Promise<SchoolMailOutcome> {
    const { id, email } = recipient;
    const institution = await findInstitution(id);
    if (!institution || (campaignId && institution.institutionType !== "school") ||
        institution.institutionEmail?.trim() !== email) {
      return { id, status: "skipped", message: "Карточка учреждения или адрес изменились. Обновите реестр." };
    }
    const claimed = await claimSchoolMail(requestId, recipient, template, message.subject, campaignId);
    if (claimed !== "claimed") return { id, status: claimed };

    let status: "sent" | "failed" | "uncertain";
    let messageId: string | null = null;
    try {
      const personalize = (text: string) => personalizeSchoolMail(text, institution.name);
      const text = personalize(design ? mailDesignText(design, message.text, message.signature) : message.text);
      const html = design
        ? renderDesignedMail(design, message.subject, message.text, message.signature, personalize, (_image, key) => "cid:" + images.get(key)!.cid)
        : renderSchoolMailHtml(message.layout, message.subject, text);
      const info = await transport.sendMail({
        from,
        to: { name: institution.name, address: email },
        replyTo: message.replyTo,
        subject: message.subject,
        text,
        html,
        attachments,
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
