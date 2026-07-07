import { decode } from "light-bolt11-decoder";

import { parseLud16 } from "@/lib/lightning/lud16";

export type PaymentIdentifier = {
  kind: "bolt12" | "bolt11" | "lud16" | "btc-address";
  value: string;
};

export const LIGHTNING_ADVISORY_USD_1E8 = 1_000n * 100_000_000n;

const NOTE_SCAN_LIMIT = 4_000;
const MAX_IDENTIFIERS = 6;
const MAX_TOKEN_LENGTH = 1_024;

const BECH32_CHARSET = "02-9ac-hj-np-z";
const BOLT12_RE = new RegExp(`^lno1[${BECH32_CHARSET}]+$`);
const BOLT11_RE = new RegExp(`^lnbc[0-9]*[munp]?1[${BECH32_CHARSET}]+$`);
const BTC_LEGACY_1_RE = /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/;
const BTC_LEGACY_3_RE = /^3[1-9A-HJ-NP-Za-km-z]{25,34}$/;
const BTC_BECH32_Q_RE = new RegExp(`^bc1q[${BECH32_CHARSET}]{6,87}$`);
const BTC_BECH32_P_RE = new RegExp(`^bc1p[${BECH32_CHARSET}]{6,87}$`);

const SURROUNDING_PUNCT_RE = /^[.,;:!?()[\]"'`]+|[.,;:!?()[\]"'`]+$/g;

function stripSurroundingPunctuation(token: string): string {
  return token.replace(SURROUNDING_PUNCT_RE, "");
}

function stripUriPrefixes(token: string): string {
  const lower = token.toLowerCase();
  if (lower.startsWith("lightning:")) {
    return token.slice("lightning:".length);
  }
  if (lower.startsWith("btc:")) {
    return token.slice("btc:".length);
  }
  if (lower.startsWith("bitcoin:")) {
    const payload = token.slice("bitcoin:".length);
    const q = payload.indexOf("?");
    return q >= 0 ? payload.slice(0, q) : payload;
  }
  return token;
}

function isValidBolt11(token: string): boolean {
  if (token.startsWith("lntb") || token.startsWith("lnbcrt")) return false;
  try {
    decode(token);
    return true;
  } catch {
    return false;
  }
}

function dedupeKey(id: PaymentIdentifier): string {
  switch (id.kind) {
    case "bolt12":
    case "bolt11":
      return `${id.kind}:${id.value.toLowerCase()}`;
    case "lud16":
      return `lud16:${id.value.toLowerCase()}`;
    case "btc-address":
      if (id.value.startsWith("bc1")) {
        return `btc:${id.value.toLowerCase()}`;
      }
      return `btc:${id.value}`;
  }
}

function classifyToken(rawToken: string): PaymentIdentifier | null {
  const stripped = stripSurroundingPunctuation(rawToken.trim());
  if (!stripped) return null;

  const token = stripUriPrefixes(stripped);

  const lower = token.toLowerCase();

  if (lower.startsWith("lno1") && lower.length >= 60 && BOLT12_RE.test(lower)) {
    return { kind: "bolt12", value: lower };
  }

  if (
    lower.startsWith("lnbc") &&
    !lower.startsWith("lnbcrt") &&
    lower.length >= 60 &&
    BOLT11_RE.test(lower) &&
    isValidBolt11(lower)
  ) {
    return { kind: "bolt11", value: lower };
  }

  if (token.includes("@")) {
    const parsed = parseLud16(token);
    if (parsed) {
      return { kind: "lud16", value: `${parsed.name}@${parsed.domain}` };
    }
  }

  if (lower.startsWith("tb1")) return null;

  if (token.startsWith("bc1")) {
    if (token !== lower) return null;
    if (BTC_BECH32_Q_RE.test(lower)) {
      return { kind: "btc-address", value: lower };
    }
    if (BTC_BECH32_P_RE.test(lower)) {
      return { kind: "btc-address", value: lower };
    }
    return null;
  }

  if (BTC_LEGACY_1_RE.test(token)) {
    return { kind: "btc-address", value: token };
  }
  if (BTC_LEGACY_3_RE.test(token)) {
    return { kind: "btc-address", value: token };
  }

  return null;
}

export function detectPaymentIdentifiers(note: string): PaymentIdentifier[] {
  const scanText = note.slice(0, NOTE_SCAN_LIMIT);
  const tokens = scanText.split(/[\s,\n;]+/);
  const seen = new Set<string>();
  const out: PaymentIdentifier[] = [];

  for (const rawToken of tokens) {
    if (out.length >= MAX_IDENTIFIERS) break;
    if (rawToken.length > MAX_TOKEN_LENGTH) continue;

    const id = classifyToken(rawToken);
    if (!id) continue;

    const key = dedupeKey(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }

  return out;
}

export function paymentIdentifierUri(id: PaymentIdentifier): string {
  switch (id.kind) {
    case "bolt12":
    case "bolt11":
    case "lud16":
      return `lightning:${id.value}`;
    case "btc-address":
      return `bitcoin:${id.value}`;
  }
}
