import { isMailColor, mailAlignments, mailImageDataUrl, mailImageWidths, mailTextSizes,
  type MailImage, type MailTextStyle, type SchoolMailDesign } from "./school-mail-design.ts";

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export type MailImageSource = (image: MailImage, key: string) => string;

function lineBreaks(value: string): string {
  return escapeHtml(value.trim()).replace(/\r\n?|\n/g, "<br>");
}

function textBlock(value: string, style: MailTextStyle, tag = "p"): string {
  if (!value.trim()) return "";
  const size = mailTextSizes.includes(style.size) ? style.size : 16;
  const align = mailAlignments.includes(style.align) ? style.align : "left";
  return `<tr><td align="${align}" style="padding:8px 24px;text-align:${align};"><${tag} style="margin:0;font-size:${size}px;line-height:1.5;font-weight:${style.bold ? "700" : "400"};overflow-wrap:anywhere;">${lineBreaks(value)}</${tag}></td></tr>`;
}

export function renderDesignedMail(
  design: SchoolMailDesign, subject: string, body: string, signature = "",
  personalize: (text: string) => string = (text) => text, source: MailImageSource = mailImageDataUrl,
): string {
  const background = isMailColor(design.backgroundColor) ? design.backgroundColor : "#ffffff";
  const ink = isMailColor(design.textColor) ? design.textColor : "#242332";
  const picture = design.background ? escapeHtml(source(design.background, "background")) : "";
  const backgroundAttribute = picture ? ` background="${picture}"` : "";
  const backgroundStyle = picture ? `background-image:url('${picture}');background-position:center top;background-size:cover;` : "";
  const rows = design.blocks.map((block, index) => {
    if (block.type === "body") return textBlock(personalize(body), block);
    if (block.type === "text") return textBlock(personalize(block.text), block);
    if (block.type === "divider") {
      return `<tr><td style="padding:12px 24px;"><table width="100%" role="presentation" cellpadding="0" cellspacing="0"><tr><td height="1" style="border-top:1px solid ${ink};font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>`;
    }
    const align = mailAlignments.includes(block.align) ? block.align : "center";
    const width = Math.round(552 * (mailImageWidths.includes(block.width) ? block.width : 100) / 100);
    const url = escapeHtml(source(block.image, String(index)));
    return `<tr><td align="${align}" style="padding:8px 24px;text-align:${align};"><img src="${url}" alt="${escapeHtml(block.alt)}" width="${width}" style="display:inline-block;width:${width}px;max-width:100%;height:auto;vertical-align:middle;border:0;"></td></tr>`;
  }).join("");
  const footer = textBlock(personalize(signature), { size: 14, align: "left", bold: false });
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;font-family:Arial,sans-serif;">
    <tr><td align="center">
      <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;table-layout:fixed;">
        <tr><td bgcolor="${background}"${backgroundAttribute} style="padding:16px 0;background-color:${background};${backgroundStyle}color:${ink};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;color:${ink};">
            ${textBlock(subject, design.heading, "h1")}${rows}${footer}
          </table>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>`;
}
