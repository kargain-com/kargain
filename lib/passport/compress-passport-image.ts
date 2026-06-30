import {
  buildPassportEncodeAttempts,
  isWithinPassportImageBudget,
  scaledDimensions,
} from "@/lib/passport/passport-image-encode-plan";
import { PassportImageOptimizeError } from "@/lib/passport/passport-image-optimize-error";

export { PASSPORT_IMAGE_TARGET_MAX_BYTES } from "@/lib/passport/passport-image-encode-plan";
export { PassportImageOptimizeError } from "@/lib/passport/passport-image-optimize-error";

const HEIC_TYPES = new Set(["image/heic", "image/heif"]);

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function isHeicFile(file: File): boolean {
  const type = file.type.toLowerCase();
  if (HEIC_TYPES.has(type)) return true;
  return /\.heic$/i.test(file.name) || /\.heif$/i.test(file.name);
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
    throw new PassportImageOptimizeError(file.name, "decode");
  }
}

async function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  if (!isBrowser()) {
    throw new PassportImageOptimizeError(file.name, "decode");
  }
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    if (dims.width <= 0 || dims.height <= 0) {
      throw new PassportImageOptimizeError(file.name, "decode");
    }
    return dims;
  } catch (err) {
    if (err instanceof PassportImageOptimizeError) throw err;
    throw new PassportImageOptimizeError(file.name, "decode");
  }
}

async function canvasToWebpBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/webp", quality);
  });
}

async function encodeAttempt(
  source: File,
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number,
  quality: number,
): Promise<Blob | null> {
  const target = scaledDimensions(sourceWidth, sourceHeight, maxEdge);
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return null;
  }

  ctx.drawImage(bitmap, 0, 0, target.width, target.height);
  bitmap.close();

  return canvasToWebpBlob(canvas, quality);
}

export async function compressPassportImage(
  file: File,
  indexHint = 0,
): Promise<File> {
  if (!isBrowser()) {
    throw new PassportImageOptimizeError(file.name, "encode");
  }

  const decodable = await normalizeToDecodableFile(file);
  const dims = await readImageDimensions(decodable);
  const attempts = buildPassportEncodeAttempts(dims.width, dims.height);

  if (attempts.length === 0) {
    throw new PassportImageOptimizeError(file.name, "budget");
  }

  let smallest: Blob | null = null;

  for (const attempt of attempts) {
    let webpBlob: Blob | null;
    try {
      webpBlob = await encodeAttempt(
        decodable,
        dims.width,
        dims.height,
        attempt.maxEdge,
        attempt.quality,
      );
    } catch {
      throw new PassportImageOptimizeError(file.name, "encode");
    }

    if (!webpBlob || webpBlob.size === 0) continue;

    if (!smallest || webpBlob.size < smallest.size) {
      smallest = webpBlob;
    }

    if (isWithinPassportImageBudget(webpBlob.size)) {
      return blobToWebpFile(webpBlob, outputFileName(indexHint));
    }
  }

  if (smallest && isWithinPassportImageBudget(smallest.size)) {
    return blobToWebpFile(smallest, outputFileName(indexHint));
  }

  throw new PassportImageOptimizeError(file.name, "budget");
}
