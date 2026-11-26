import { ImapFlow } from "imapflow";
import PostalMime from "postal-mime";
import { convert } from "html-to-text";
import { schoolMailTemplates, type SchoolReply } from "../lib/school-mail.ts";
import { listSentSchoolMail, markSchoolsReplied, type SentSchoolMail } from "../lib/store.ts";

const daysToSearch = 90;
const maximumReplies = 50;
const maximumSourceBytes = 512 * 1024;
const replyPrefix = /^(?:(?:re|ответ)\s*:\s*)+/i;

function mailboxClient(): ImapFlow {
  const host = process.env.IMAP_HOST || (process.env.SMTP_HOST === "smtp.mail.ru" ? "imap.mail.ru" : "");
  const port = Number(process.env.IMAP_PORT ?? "993");
  const user = process.env.IMAP_USER || process.env.SMTP_USER;
  const pass = process.env.IMAP_PASS || process.env.SMTP_PASS;
  if (!host || !user || !pass || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Входящая почта ещё не настроена. Обратитесь к администратору.");
  }
  const client = new ImapFlow({
    host, port, secure: true, auth: { user, pass }, logger: false, disableAutoIdle: true,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  });
  client.on("error", () => {});
  return client;
}

function matchDelivery(
  deliveries: SentSchoolMail[], subject: string, headers: string, receivedAt: Date,
): SentSchoolMail | undefined {
  const earlier = deliveries.filter(({ sentAt }) => sentAt <= receivedAt);
  const references = new Set(headers.match(/<[^<>\s]+>/g) ?? []);
  const linked = earlier.find(({ messageId }) => messageId && references.has(messageId));
  if (linked) return linked;

  // Earlier versions did not record SMTP message IDs.
  if (!replyPrefix.test(subject)) return;
  const originalSubject = subject.replace(replyPrefix, "").trim().toLocaleLowerCase("ru");
  const candidates = earlier.filter(({ template }) =>
    schoolMailTemplates[template]?.toLocaleLowerCase("ru") === originalSubject);
  if (new Set(candidates.map(({ schoolId }) => schoolId)).size === 1) {
    return candidates.find(({ messageId }) => !messageId);
  }
}

let pending: Promise<SchoolReply[]> | undefined;

export function readSchoolReplies(): Promise<SchoolReply[]> {
  pending ??= loadReplies().finally(() => { pending = undefined; });
  return pending;
}

async function loadReplies(): Promise<SchoolReply[]> {
  const since = new Date(Date.now() - daysToSearch * 86_400_000);
  const sent = await listSentSchoolMail(since);
  const bySender = new Map<string, SentSchoolMail[]>();
  for (const delivery of sent) {
    const email = delivery.recipient.toLowerCase();
    const list = bySender.get(email);
    if (list) list.push(delivery);
    else bySender.set(email, [delivery]);
  }
  const senders = [...bySender.keys()];
  if (!senders.length) return [];

  const replies: SchoolReply[] = [];
  const client = mailboxClient();
  const deadline = setTimeout(() => client.close(), 40_000);
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const candidateUids = new Set<number>();
      for (let i = 0; i < senders.length; i += 25) {
        const from = senders.slice(i, i + 25).map((address) => ({ from: address }));
        const uids = await client.search({ since, ...(from.length === 1 ? from[0] : { or: from }) }, { uid: true });
        if (!uids) throw new Error("IMAP search failed");
        uids.slice(-200).forEach((uid) => candidateUids.add(uid));
      }
      const recent = [...candidateUids].sort((a, b) => b - a).slice(0, 200);
      if (recent.length) {
        const messages = await client.fetchAll(recent, {
          envelope: true, internalDate: true, headers: ["in-reply-to", "references", "auto-submitted"],
        }, { uid: true });
        const matched = new Map<number, Omit<SchoolReply, "text">>();
        for (const message of messages.sort((a, b) => b.uid - a.uid)) {
          const sender = message.envelope?.from?.[0]?.address?.toLowerCase();
          const deliveries = sender && bySender.get(sender);
          const subject = message.envelope?.subject?.trim() ?? "";
          const headers = message.headers?.toString("utf8") ?? "";
          const autoSubmitted = /^auto-submitted:[ \t]*([^;\s]+)/im.exec(headers)?.[1]?.toLowerCase();
          const receivedAt = message.internalDate ? new Date(message.internalDate) : undefined;
          if (!sender || !deliveries || !receivedAt || !Number.isFinite(receivedAt.getTime()) ||
              (autoSubmitted && autoSubmitted !== "no")) continue;
          const delivery = matchDelivery(deliveries, subject, headers, receivedAt);
          if (!delivery) continue;
          matched.set(message.uid, { id: message.uid, schoolId: delivery.schoolId, schoolName: delivery.schoolName,
            sender, subject, receivedAt: receivedAt.toISOString() });
          if (matched.size === maximumReplies) break;
        }
        const ids = [...matched.keys()];
        for (let i = 0; i < ids.length; i += 8) {
          const bodies = await client.fetchAll(ids.slice(i, i + 8), {
            source: { start: 0, maxLength: maximumSourceBytes },
          }, { uid: true });
          for (const { uid, source } of bodies) {
            const reply = matched.get(uid);
            if (!source || !reply) continue;
            const parsed = await PostalMime.parse(source, { maxRfc822NestingDepth: 0 }).catch(() => undefined);
            const text = parsed?.text?.trim() || (parsed?.html
              ? convert(parsed.html, { wordwrap: false, selectors: [
                { selector: "img", format: "skip" },
                { selector: "a", options: { ignoreHref: true } },
              ] }).trim() : "");
            replies.push({ ...reply, text: text.slice(0, 16_000) });
          }
        }
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    if ((error as { authenticationFailed?: boolean } | null)?.authenticationFailed) {
      throw new Error("Почта отклонила вход по IMAP. Проверьте доступ к IMAP и пароль приложения.");
    }
    throw new Error("Не удалось загрузить ответы из почтового ящика. Попробуйте ещё раз.");
  } finally {
    clearTimeout(deadline);
    client.close();
  }
  await markSchoolsReplied([...new Set(replies.map(({ schoolId }) => schoolId))]);
  return replies.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id - a.id);
}
