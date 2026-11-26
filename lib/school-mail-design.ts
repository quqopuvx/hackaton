export const mailDesignImageLimit = 5;
export const mailDesignImageBytes = 400 * 1024;
export const mailDesignBlockLimit = 12;
export const mailDesignRequestLimit = 4 * 1024 * 1024;
export const mailImageTypes = ["image/png", "image/jpeg", "image/gif"] as const;
export const mailAlignments = ["left", "center", "right"] as const;
export const mailImageWidths = [25, 50, 75, 100] as const;
export const mailTextSizes = [12, 14, 16, 18, 20, 24, 28, 32, 36, 42] as const;

export type MailAlignment = typeof mailAlignments[number];
export type MailImageType = typeof mailImageTypes[number];
export type MailTextSize = typeof mailTextSizes[number];

export interface MailImage {
  mime: MailImageType;
  data: string;
}

export interface MailTextStyle {
  size: MailTextSize;
  align: MailAlignment;
  bold: boolean;
}

export type MailDesignBlock = (MailTextStyle & ({ type: "body" } | { type: "text"; text: string })) |
  { type: "image"; image: MailImage; width: typeof mailImageWidths[number]; align: MailAlignment; alt: string } |
  { type: "divider" };

export interface SchoolMailDesign {
  backgroundColor: string;
  textColor: string;
  background: MailImage | null;
  heading: MailTextStyle;
  blocks: MailDesignBlock[];
}

export function defaultMailDesign(): SchoolMailDesign {
  return {
    backgroundColor: "#ffffff", textColor: "#242332", background: null,
    heading: { size: 28, align: "left", bold: true },
    blocks: [{ type: "body", size: 16, align: "left", bold: false }],
  };
}

export function isMailColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function isMailImage(value: unknown): value is MailImage {
  if (!value || typeof value !== "object") return false;
  const { mime, data } = value as Partial<MailImage>;
  if (typeof data !== "string" || data.length < 16 || data.length % 4 !== 0 ||
      data.length > Math.ceil(mailDesignImageBytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return false;
  const bytes = data.length * 3 / 4 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
  if (bytes > mailDesignImageBytes) return false;
  if (mime === "image/png") return data.startsWith("iVBORw0KGgo");
  if (mime === "image/jpeg") return data.startsWith("/9j/");
  if (mime === "image/gif") return data.startsWith("R0lGODdh") || data.startsWith("R0lGODlh");
  return false;
}

export function mailImageDataUrl(image: MailImage): string {
  return `data:${image.mime};base64,${image.data}`;
}

function isTextStyle(value: unknown): value is MailTextStyle {
  if (!value || typeof value !== "object") return false;
  const { size, align, bold } = value as MailTextStyle;
  return mailTextSizes.includes(size) && mailAlignments.includes(align) && typeof bold === "boolean";
}

function isDesignBlock(value: unknown): value is MailDesignBlock {
  if (!value || typeof value !== "object") return false;
  const block = value as MailDesignBlock;
  if (block.type === "body") return isTextStyle(block);
  if (block.type === "text") {
    return isTextStyle(block) && typeof block.text === "string" && block.text.length <= 3000 && !block.text.includes("\0");
  }
  if (block.type === "image") {
    return mailImageWidths.includes(block.width) && mailAlignments.includes(block.align) && isMailImage(block.image) &&
      typeof block.alt === "string" && block.alt.length <= 200 && !/[\r\n\0]/.test(block.alt);
  }
  return block.type === "divider";
}

export function isSchoolMailDesign(value: unknown): value is SchoolMailDesign {
  if (!value || typeof value !== "object") return false;
  const { blocks, heading, background, backgroundColor, textColor } = value as Partial<SchoolMailDesign>;
  return isMailColor(backgroundColor) && isMailColor(textColor) && isTextStyle(heading) &&
    (background === null || isMailImage(background)) && Array.isArray(blocks) && blocks.length <= mailDesignBlockLimit &&
    blocks.every(isDesignBlock) && blocks.filter(({ type }) => type === "body").length === 1 &&
    blocks.filter(({ type }) => type === "image").length <= mailDesignImageLimit;
}

export function mailDesignText(design: SchoolMailDesign, body: string, signature = ""): string {
  const parts = design.blocks.flatMap((block) => {
    if (block.type === "body") return body.trim();
    if (block.type === "text") return block.text.trim();
    return [];
  });
  return [...parts, signature.trim()].filter(Boolean).join("\n\n");
}
