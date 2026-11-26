import { isMailImage, mailDesignImageBytes, mailImageTypes, type MailImage } from "../lib/school-mail-design";

async function encodeImage(blob: Blob): Promise<MailImage> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject();
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const image = { mime: blob.type, data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
  if (!isMailImage(image)) throw new Error("Не удалось прочитать изображение или уменьшить его до 400 КБ.");
  return image;
}

export async function loadMailImage(file: File): Promise<MailImage> {
  if (!mailImageTypes.some((mime) => mime === file.type)) throw new Error("Выберите изображение PNG, JPEG или GIF.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Выберите файл размером до 20 МБ.");
  if (file.type === "image/gif" && file.size > mailDesignImageBytes) throw new Error("Размер GIF не должен превышать 400 КБ.");

  const image = await createImageBitmap(file).catch(() => { throw new Error("Не удалось открыть изображение."); });
  try {
    if (file.size <= mailDesignImageBytes && (file.type === "image/gif" || Math.max(image.width, image.height) <= 1400)) {
      return await encodeImage(file);
    }
    const canvas = document.createElement("canvas");
    const ratio = Math.min(1400 / Math.max(image.width, image.height), 1);
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Браузер не смог подготовить изображение.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = (mime: string, quality?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
    if (file.type === "image/png") {
      const png = await blob(file.type);
      if (png && png.size <= mailDesignImageBytes) return await encodeImage(png);
    }
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.65, 0.45]) {
      const jpeg = await blob("image/jpeg", quality);
      if (jpeg && jpeg.size <= mailDesignImageBytes) return await encodeImage(jpeg);
    }
    throw new Error("Не удалось уменьшить изображение до 400 КБ. Попробуйте файл меньшего размера.");
  } finally {
    image.close();
  }
}
