export const PASSPORT_IMAGE_TARGET_MAX_BYTES = 100 * 1024;

export const PASSPORT_IMAGE_INITIAL_MAX_EDGE_PX = 1280;
export const PASSPORT_IMAGE_MIN_MAX_EDGE_PX = 480;

export const PASSPORT_IMAGE_INITIAL_QUALITY = 0.82;
export const PASSPORT_IMAGE_MIN_QUALITY = 0.45;
export const PASSPORT_IMAGE_QUALITY_STEP = 0.06;
export const PASSPORT_IMAGE_EDGE_SCALE = 0.85;

export type PassportEncodeAttempt = {
  maxEdge: number;
  quality: number;
};

export function isWithinPassportImageBudget(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > 0 && bytes <= PASSPORT_IMAGE_TARGET_MAX_BYTES;
}

export function scaledDimensions(
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

function initialMaxEdge(width: number, height: number): number {
  const sourceEdge = Math.max(width, height);
  if (sourceEdge <= 0) return PASSPORT_IMAGE_INITIAL_MAX_EDGE_PX;
  return Math.min(sourceEdge, PASSPORT_IMAGE_INITIAL_MAX_EDGE_PX);
}

function nextQuality(quality: number): number | null {
  const next = Math.round((quality - PASSPORT_IMAGE_QUALITY_STEP) * 100) / 100;
  if (next < PASSPORT_IMAGE_MIN_QUALITY) return null;
  return next;
}

function nextMaxEdge(maxEdge: number): number | null {
  const next = Math.floor(maxEdge * PASSPORT_IMAGE_EDGE_SCALE);
  if (next < PASSPORT_IMAGE_MIN_MAX_EDGE_PX) return null;
  return next;
}

export function buildPassportEncodeAttempts(
  width: number,
  height: number,
): PassportEncodeAttempt[] {
  const attempts: PassportEncodeAttempt[] = [];
  let maxEdge = initialMaxEdge(width, height);

  while (maxEdge >= PASSPORT_IMAGE_MIN_MAX_EDGE_PX) {
    let quality = PASSPORT_IMAGE_INITIAL_QUALITY;

    while (quality >= PASSPORT_IMAGE_MIN_QUALITY) {
      attempts.push({ maxEdge, quality });
      const lowered = nextQuality(quality);
      if (lowered == null) break;
      quality = lowered;
    }

    const shrunk = nextMaxEdge(maxEdge);
    if (shrunk == null || shrunk === maxEdge) break;
    maxEdge = shrunk;
  }

  return attempts;
}
