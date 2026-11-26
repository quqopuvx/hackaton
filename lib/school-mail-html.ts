import type { SchoolMailLayout } from "./school-mail.ts";

const themes = {
  promotion: { accent: "#5b2999", header: "#34165c", background: "#f2eaf9", label: "ДЛЯ ВАШЕЙ ШКОЛЫ" },
  invitation: { accent: "#006b62", header: "#064840", background: "#e8f5f1", label: "ПРИГЛАШЕНИЕ" },
  newsletter: { accent: "#9d471f", header: "#613017", background: "#fbefe5", label: "НОВОСТИ И АНОНСЫ" },
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function renderSchoolMailHtml(layout: SchoolMailLayout, subject: string, text: string): string | undefined {
  if (layout === "plain") return;

  const theme = themes[layout];
  const paragraphs = text.trim().replace(/\r\n?/g, "\n").split(/\n(?:[^\S\n]*\n)+/).filter(Boolean).map((paragraph) => {
    const content = escapeHtml(paragraph).replaceAll("\n", "<br>");
    const style = "margin:0 0 16px;font-size:16px;line-height:1.6;overflow-wrap:anywhere;";
    if (layout === "invitation" && /^Дата и время:/i.test(paragraph)) {
      return `<p style="${style}padding:12px 16px;background-color:${theme.background};border-left:4px solid ${theme.accent};">${content}</p>`;
    }
    return `<p style="${style}">${content}</p>`;
  }).join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${theme.background}" style="width:100%;background-color:${theme.background};font-family:Arial,sans-serif;">
    <tr><td align="center" style="padding:20px 12px;">
      <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background-color:#ffffff;table-layout:fixed;">
        <tr><td bgcolor="${theme.header}" style="background-color:${theme.header};color:#ffffff;border-top:6px solid ${theme.accent};padding:24px;">
          <p style="margin:0 0 8px;color:#ffffff;font-size:12px;line-height:1.4;font-weight:bold;letter-spacing:1.3px;">${theme.label}</p>
          <h1 style="margin:0;color:#ffffff;font-size:26px;line-height:1.2;font-weight:bold;overflow-wrap:anywhere;">${escapeHtml(subject)}</h1>
        </td></tr>
        <tr><td bgcolor="#ffffff" style="background-color:#ffffff;color:#242332;padding:22px 24px 8px;text-align:left;">${paragraphs}</td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>`;
}
