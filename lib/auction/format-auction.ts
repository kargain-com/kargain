import { formatUnits } from "viem";

import type { CommercialNativeUnit } from "@/lib/web3/commercial-native-unit";
import {
  formatNativeAmount,
  formatNativeAmountLabeled,
} from "@/lib/web3/native-amount";

const USDC_DECIMALS = 6;

/** Format auction amount for display (native unit or USDC). Mono substitutions. */
export function formatAuctionAmount(
  amount: bigint,
  assetLabel: "ETH" | "USDC",
  nativeUnit: CommercialNativeUnit,
): string {
  if (assetLabel === "USDC") {
    const raw = formatUnits(amount, USDC_DECIMALS);
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return `${raw} USDC`;
    return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;
  }
  const raw = formatNativeAmount(amount, nativeUnit);
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) {
    return formatNativeAmountLabeled(amount, nativeUnit);
  }
  const grouped =
    n >= 1
      ? n.toLocaleString("en-US", { maximumFractionDigits: 4 })
      : n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return `${grouped} ${nativeUnit.symbol}`;
}

/** Remaining time at minute granularity for browse cards. */
export function formatAuctionCountdownMinutes(
  endsAtSec: bigint,
  nowSec: number,
): string {
  if (endsAtSec <= 0n) return "";
  const ends = Number(endsAtSec);
  const rem = ends - nowSec;
  if (rem <= 0) return "Ended";
  const mins = Math.floor(rem / 60);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) {
    const m = mins % 60;
    return m > 0 ? `${hours}h ${m}m left` : `${hours}h left`;
  }
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h > 0 ? `${days}d ${h}h left` : `${days}d left`;
}

/** Second-granularity countdown for lot readout. */
export function formatAuctionCountdownSeconds(
  endsAtSec: bigint,
  nowSec: number,
): string {
  if (endsAtSec <= 0n) return "—";
  const rem = Number(endsAtSec) - nowSec;
  if (rem <= 0) return "Ended";
  const s = rem % 60;
  const m = Math.floor(rem / 60) % 60;
  const h = Math.floor(rem / 3600) % 24;
  const d = Math.floor(rem / 86400);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

export function endsAtDateTimeAttr(endsAtSec: bigint): string | undefined {
  if (endsAtSec <= 0n) return undefined;
  return new Date(Number(endsAtSec) * 1000).toISOString();
}
