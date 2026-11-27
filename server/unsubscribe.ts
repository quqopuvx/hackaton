import { createServer } from "node:http";
import { handleApplicantUnsubscribe } from "./applicant-mail.ts";
import { loadLocalEnv } from "./env.ts";

loadLocalEnv();

const port = Number(process.env.APPLICANT_UNSUBSCRIBE_PORT ?? 5174);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Укажите порт от 1 до 65535 в APPLICANT_UNSUBSCRIBE_PORT.");
}

createServer((req, res) => {
  const pathname = req.url?.split("?", 1)[0] ?? "";
  if (handleApplicantUnsubscribe(req, res, pathname)) return;
  res.writeHead(404, { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" });
  res.end("Страница не найдена.");
}).listen(port, "127.0.0.1", () => {
  console.log(`Страница отписки: http://127.0.0.1:${port}`);
});
