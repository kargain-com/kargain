/** Mirrors MarketplaceEscrow._RETURN_COOLDOWN — 7 days in seconds. */

export const RETURN_COOLDOWN_SECONDS = 604_800n;

export function returnDeadline(returnRequestedAt: bigint): bigint {
  return returnRequestedAt + RETURN_COOLDOWN_SECONDS;
}

export function returnRemainingSeconds(
  returnRequestedAt: bigint,
  nowSec: bigint,
): bigint {
  const remaining = returnDeadline(returnRequestedAt) - nowSec;
  return remaining > 0n ? remaining : 0n;
}

function plural(count: bigint, unit: string): string {
  const n = Number(count);
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export function formatReturnCountdown(remainingSec: bigint): string {
  if (remainingSec <= 0n) return "0 seconds";

  const days = remainingSec / 86_400n;
  if (days >= 2n) {
    return plural(days, "day");
  }
  if (days === 1n) {
    const hours = (remainingSec % 86_400n) / 3_600n;
    return hours > 0n
      ? `${plural(days, "day")} ${plural(hours, "hour")}`
      : plural(days, "day");
  }

  const hours = remainingSec / 3_600n;
  if (hours >= 1n) {
    const minutes = (remainingSec % 3_600n) / 60n;
    return minutes > 0n
      ? `${plural(hours, "hour")} ${plural(minutes, "minute")}`
      : plural(hours, "hour");
  }

  const minutes = remainingSec / 60n;
  if (minutes >= 1n) {
    const seconds = remainingSec % 60n;
    return seconds > 0n
      ? `${plural(minutes, "minute")} ${plural(seconds, "second")}`
      : plural(minutes, "minute");
  }

  return plural(remainingSec, "second");
}
