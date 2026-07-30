/**
 * Format on-chain window lengths for product copy.
 * Returns null when unread or invalid — callers omit the numeric claim.
 */

const DAY = 86_400;
const HOUR = 3_600;
const MINUTE = 60;

export function formatWindowDurationLabel(
  seconds: number | bigint | null | undefined,
): string | null {
  if (seconds == null) return null;
  const sec =
    typeof seconds === "bigint" ? Number(seconds) : Math.trunc(seconds);
  if (!Number.isFinite(sec) || sec <= 0) return null;

  if (sec % DAY === 0) {
    const d = sec / DAY;
    return d === 1 ? "1 day" : `${d} days`;
  }
  if (sec % HOUR === 0) {
    const h = sec / HOUR;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  if (sec % MINUTE === 0) {
    const m = sec / MINUTE;
    return m === 1 ? "1 minute" : `${m} minutes`;
  }
  return `${sec} seconds`;
}

/** Whole-day options within chain min/max duration (seconds). */
export function durationDayOptions(minSec: number, maxSec: number): number[] {
  const minDays = Math.max(1, Math.ceil(minSec / DAY));
  const maxDays = Math.max(minDays, Math.floor(maxSec / DAY));
  const out: number[] = [];
  for (let d = minDays; d <= maxDays; d++) out.push(d);
  return out;
}

export function durationBoundsErrorMessage(
  minSec: number,
  maxSec: number,
): string {
  const minLabel = formatWindowDurationLabel(minSec) ?? "the minimum";
  const maxLabel = formatWindowDurationLabel(maxSec) ?? "the maximum";
  return `Duration must be between ${minLabel} and ${maxLabel}.`;
}
