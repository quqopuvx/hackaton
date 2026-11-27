import { createHash, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { isSingleEmail } from "../lib/school-mail.ts";

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

export function mailConfigured(): boolean {
  return Boolean(smtpConfig());
}

export function authorizeMail(code: string): "unconfigured" | "denied" | "allowed" {
  const config = smtpConfig();
  if (!config) return "unconfigured";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(code), digest(config.accessCode)) ? "allowed" : "denied";
}

export function createMailTransport() {
  const config = smtpConfig();
  if (!config) throw new Error("Отправка писем ещё не настроена.");
  const transport = nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.port === 465, requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.pass }, pool: true, maxConnections: 3,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  return { from: { name: "МеркурИИй", address: config.from }, transport };
}
