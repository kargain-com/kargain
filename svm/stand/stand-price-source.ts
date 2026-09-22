/**
 * Sole stand constants for FixedPrice fiat price accounts.
 * Values match stand-price-source.json (lab measurement: Pyth receiver + sponsored SOL/USD).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.join(HERE, "stand-price-source.json");

type StandPriceSourceJson = {
  receiverProgramId: string;
  feedIdHex: string;
  accounts: {
    fresh: { address: string };
    stale: { address: string };
    wide: { address: string };
    bad: { address: string };
  };
  bootJsonDefault: string;
  publishTimeOffset: number;
};

const SRC = JSON.parse(readFileSync(JSON_PATH, "utf8")) as StandPriceSourceJson;

export const STAND_PRICE_RECEIVER = new PublicKey(SRC.receiverProgramId);
export const STAND_PRICE_FEED_ID = Buffer.from(SRC.feedIdHex, "hex");
export const STAND_PRICE_FRESH = new PublicKey(SRC.accounts.fresh.address);
export const STAND_PRICE_STALE = new PublicKey(SRC.accounts.stale.address);
export const STAND_PRICE_WIDE = new PublicKey(SRC.accounts.wide.address);
export const STAND_PRICE_BAD = new PublicKey(SRC.accounts.bad.address);
export const STAND_PRICE_PUBLISH_TIME_OFFSET = SRC.publishTimeOffset;
export const STAND_PRICE_BOOT_JSON =
  process.env.KARGAIN_SVM_STAND_PRICE_BOOT ?? SRC.bootJsonDefault;

export type StandPriceBoot = {
  path: "clone" | "fixture";
  receiverProgramId: string;
  feedIdHex: string;
  accounts: {
    fresh: string;
    stale: string;
    wide: string;
    bad: string;
  };
};

export function loadStandPriceBoot(): StandPriceBoot {
  return JSON.parse(readFileSync(STAND_PRICE_BOOT_JSON, "utf8")) as StandPriceBoot;
}

/** Decode PriceUpdateV2 publish_time (i64 LE @ offset 93). */
export function readPricePublishTime(data: Buffer): number {
  return Number(data.readBigInt64LE(STAND_PRICE_PUBLISH_TIME_OFFSET));
}

/** PriceUpdateV2 price_i64 @73 + exponent_i32 @89. */
export function readPriceReading(data: Buffer): { price: bigint; expo: number; conf: bigint } {
  return {
    price: data.readBigInt64LE(73),
    conf: data.readBigUInt64LE(81),
    expo: data.readInt32LE(89),
  };
}

/** Mirror `kargain_price::price_to_usd_1e8`. */
export function priceToUsd1e8(price: bigint, expo: number): bigint {
  if (price <= 0n) throw new Error("BadOracleAnswer");
  const power = 8 + expo;
  if (power === 0) return price;
  if (power > 0) return price * 10n ** BigInt(power);
  return price / 10n ** BigInt(-power);
}

/** Mirror `kargain_price::fiat_usd_1e8_to_token_amount`. */
export function fiatUsd1e8ToTokenAmount(
  fiatPrice1e8: bigint,
  reading: { price: bigint; expo: number },
  tokenDecimals: number,
): bigint {
  const feed1e8 = priceToUsd1e8(reading.price, reading.expo);
  if (feed1e8 === 0n) throw new Error("BadOracleAnswer");
  const scale = 10n ** BigInt(tokenDecimals);
  return (fiatPrice1e8 * scale) / feed1e8;
}

/** Program admit bounds (kargain-price / D-07). */
export const STAND_PRICE_STALENESS_MIN_SECS = 60;
export const STAND_PRICE_STALENESS_MAX_SECS = 259_200;

/**
 * Named worst-case stand wall-clock between fiat admit and the last fresh Buy.
 * Measured full `--live` on 6d-1 was 196s; 600s is ~3× that full run
 * (admit→buy is a slice of FixedPrice, well under 196s).
 */
export const STAND_PRICE_FRESH_BUY_BUDGET_SECS = 600;

export const CLONE_SKEW_EXCEEDS_PROGRAM_MAX = "clone_skew_exceeds_program_max";

/**
 * Admit staleness = skew + named run budget, floored at 60.
 * Refuses by name when that sum exceeds the program maximum (never silent cap).
 */
export function admitStalenessTolerance(skewSeconds: number): number {
  const skew = Math.max(0, Math.floor(skewSeconds));
  const raw = skew + STAND_PRICE_FRESH_BUY_BUDGET_SECS;
  if (raw > STAND_PRICE_STALENESS_MAX_SECS) {
    throw new Error(CLONE_SKEW_EXCEEDS_PROGRAM_MAX);
  }
  return Math.max(STAND_PRICE_STALENESS_MIN_SECS, raw);
}
