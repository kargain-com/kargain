export const PASSPORT_IMAGE_MAX_EDGE_PX = 2048;
export const PASSPORT_IMAGE_WEBP_QUALITY = 0.85;
export const PASSPORT_IMAGE_SKIP_MAX_BYTES = 400_000;

const HEIC_TYPES = new Set(["image/heic", "image/heif"]);
const SKIP_TYPES = new Set(["image/webp", "image/jpeg", "image/jpg"]);

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function isHeicFile(file: File): boolean {
  const type = file.type.toLowerCase();
  if (HEIC_TYPES.has(type)) return true;
  return /\.heic$/i.test(file.name) || /\.heif$/i.test(file.name);
}

export function shouldSkipPassportImageCompression(
  file: File,
  width: number,
  height: number,
): boolean {
  const type = file.type.toLowerCase();
  if (!SKIP_TYPES.has(type)) return false;
  if (file.size > PASSPORT_IMAGE_SKIP_MAX_BYTES) return false;
  const maxEdge = Math.max(width, height);
  return maxEdge > 0 && maxEdge <= PASSPORT_IMAGE_MAX_EDGE_PX;
}

function scaledDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const maxCurrent = Math.max(width, height);
  if (maxCurrent <= maxEdge) return { width, height };
  const scale = maxEdge / maxCurrent;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function outputFileName(indexHint: number): string {
  return `photo-${String(indexHint).padStart(3, "0")}.webp`;
}

async function blobToWebpFile(blob: Blob, fileName: string): Promise<File> {
  return new File([blob], fileName, { type: "image/webp" });
}

export async function normalizeToDecodableFile(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;
  if (!isBrowser()) return file;

  try {
    const heic2any = (await import("heic2any")).default;
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    const blob = Array.isArray(converted) ? converted[0]! : converted;
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

async function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  if (!isBrowser()) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return null;
  }
}

async function canvasToWebpBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      "image/webp",
      PASSPORT_IMAGE_WEBP_QUALITY,
    );
  });
}

export async function compressPassportImage(
  file: File,
  indexHint = 0,
): Promise<File> {
  if (!isBrowser()) return file;

  try {
    const decodable = await normalizeToDecodableFile(file);
    const dims = await readImageDimensions(decodable);
    if (!dims) return decodable;

    if (shouldSkipPassportImageCompression(decodable, dims.width, dims.height)) {
      return decodable;
    }

    const target = scaledDimensions(
      dims.width,
      dims.height,
      PASSPORT_IMAGE_MAX_EDGE_PX,
    );

    const bitmap = await createImageBitmap(decodable);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return decodable;
    }

    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    bitmap.close();

    const webpBlob = await canvasToWebpBlob(canvas);
    if (!webpBlob || webpBlob.size === 0) return decodable;

    if (webpBlob.size >= decodable.size && SKIP_TYPES.has(decodable.type.toLowerCase())) {
      return decodable;
    }

    return blobToWebpFile(webpBlob, outputFileName(indexHint));
  } catch {
    return file;
  }
}
