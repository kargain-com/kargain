"use client";

import { hexToBytes } from "viem";
import { finalizeEvent, type EventTemplate, getPublicKey } from "nostr-tools";
import * as nip04 from "nostr-tools/nip04";
import * as nip44 from "nostr-tools/nip44";
import type { SimplePool } from "nostr-tools/pool";

import { getNostrPool } from "@/lib/nostr/nostr-client";
import type { ParsedNwcConnection } from "@/lib/nostr/nwc/nwc-uri";

const KIND_WALLET_INFO = 13194;
const KIND_NWC_REQUEST = 23194;
const KIND_NWC_RESPONSE = 23195;

export type NwcEncryption = "nip44" | "nip04";

export type NwcWalletInfo = {
  supportsPayInvoice: boolean;
  encryption: NwcEncryption;
};

export type NwcErrorCode =
  | "unsupported"
  | "timeout"
  | "relay_unreachable"
  | "unlock_declined"
  | "rejected"
  | "insufficient_balance"
  | "invalid_response";

export type NwcPayResult =
  | { ok: true; preimage: string }
  | { ok: false; code: NwcErrorCode };

type NwcClientOptions = {
  timeoutMs?: number;
  pool?: SimplePool;
};

function secretBytes(secretHex: string): Uint8Array {
  return hexToBytes(`0x${secretHex}` as `0x${string}`);
}

function parseInfoContent(content: string): { supportsPayInvoice: boolean; encryption: NwcEncryption } {
  const methods = content.trim().split(/\s+/).filter(Boolean);
  const supportsPayInvoice = methods.includes("pay_invoice");
  return { supportsPayInvoice, encryption: "nip04" };
}

function parseInfoEncryption(tags: string[][]): NwcEncryption {
  for (const tag of tags) {
    if (tag[0] !== "encryption") continue;
    const value = tag[1]?.toLowerCase() ?? "";
    if (value === "nip44_v2" || value === "nip44") return "nip44";
  }
  return "nip04";
}

export async function fetchWalletInfo(
  conn: ParsedNwcConnection,
  options: NwcClientOptions = {},
): Promise<NwcWalletInfo> {
  const { timeoutMs = 10_000, pool = getNostrPool() } = options;
  try {
    const events = await pool.querySync(
      [conn.relayUrl],
      { kinds: [KIND_WALLET_INFO], authors: [conn.walletPubkey], limit: 1 },
      { maxWait: timeoutMs },
    );
    if (events.length === 0) {
      return { supportsPayInvoice: false, encryption: "nip04" };
    }
    const event = events[0];
    const parsed = parseInfoContent(event.content);
    const encryption = parseInfoEncryption(event.tags);
    return {
      supportsPayInvoice: parsed.supportsPayInvoice,
      encryption,
    };
  } catch {
    throw new Error("relay_unreachable");
  }
}

async function encryptPayload(
  conn: ParsedNwcConnection,
  encryption: NwcEncryption,
  json: string,
): Promise<string> {
  if (encryption === "nip44") {
    const key = nip44.v2.utils.getConversationKey(secretBytes(conn.secretHex), conn.walletPubkey);
    return nip44.v2.encrypt(json, key);
  }
  return nip04.encrypt(conn.secretHex, conn.walletPubkey, json);
}

async function decryptPayload(
  conn: ParsedNwcConnection,
  encryption: NwcEncryption,
  payload: string,
): Promise<string> {
  if (encryption === "nip44") {
    const key = nip44.v2.utils.getConversationKey(secretBytes(conn.secretHex), conn.walletPubkey);
    return nip44.v2.decrypt(payload, key);
  }
  return nip04.decrypt(conn.secretHex, conn.walletPubkey, payload);
}

function mapNwcErrorCode(code: string | undefined): NwcErrorCode {
  const normalized = code?.toUpperCase() ?? "";
  if (normalized === "INSUFFICIENT_BALANCE") return "insufficient_balance";
  if (
    normalized === "NOT_AUTHORIZED" ||
    normalized === "RESTRICTED" ||
    normalized === "QUOTA_EXCEEDED"
  ) {
    return "rejected";
  }
  return "invalid_response";
}

export async function payInvoice(
  conn: ParsedNwcConnection,
  invoice: string,
  options: NwcClientOptions & { encryption?: NwcEncryption } = {},
): Promise<NwcPayResult> {
  const { timeoutMs = 60_000, pool = getNostrPool(), encryption = "nip44" } = options;
  const secret = secretBytes(conn.secretHex);
  const ourPubkey = getPublicKey(secret);

  let encrypted: string;
  try {
    encrypted = await encryptPayload(
      conn,
      encryption,
      JSON.stringify({ method: "pay_invoice", params: { invoice } }),
    );
  } catch {
    return { ok: false, code: "invalid_response" };
  }

  const unsigned: EventTemplate = {
    kind: KIND_NWC_REQUEST,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["p", conn.walletPubkey],
      ...(encryption === "nip44" ? ([["encryption", "nip44_v2"]] as string[][]) : []),
    ],
    content: encrypted,
  };

  const signed = finalizeEvent(unsigned, secret);
  const reqId = signed.id;

  return await new Promise<NwcPayResult>((resolve) => {
    let settled = false;
    let sub: { close: () => void } | null = null;
    const finish = (result: NwcPayResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub?.close();
      resolve(result);
    };

    const timer = setTimeout(() => finish({ ok: false, code: "timeout" }), timeoutMs);

    try {
      sub = pool.subscribe(
        [conn.relayUrl],
        {
          kinds: [KIND_NWC_RESPONSE],
          "#e": [reqId],
          "#p": [ourPubkey],
        },
        {
          onevent: async (event) => {
            let decrypted: string;
            try {
              decrypted = await decryptPayload(conn, encryption, event.content);
            } catch {
              finish({ ok: false, code: "invalid_response" });
              return;
            }

            let parsed: {
              result?: { preimage?: string };
              error?: { code?: string };
            };
            try {
              parsed = JSON.parse(decrypted) as typeof parsed;
            } catch {
              finish({ ok: false, code: "invalid_response" });
              return;
            }

            if (parsed.error) {
              finish({ ok: false, code: mapNwcErrorCode(parsed.error.code) });
              return;
            }

            const preimage = parsed.result?.preimage;
            if (typeof preimage === "string" && preimage.length > 0) {
              finish({ ok: true, preimage });
              return;
            }

            finish({ ok: false, code: "invalid_response" });
          },
        },
      );

      void Promise.all(pool.publish([conn.relayUrl], signed)).catch(() => {
        finish({ ok: false, code: "relay_unreachable" });
      });
    } catch {
      finish({ ok: false, code: "relay_unreachable" });
    }
  });
}

export const __testing = {
  parseInfoContent,
  parseInfoEncryption,
  mapNwcErrorCode,
  KIND_NWC_REQUEST,
  KIND_NWC_RESPONSE,
};
