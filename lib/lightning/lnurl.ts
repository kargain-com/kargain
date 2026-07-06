import { decode } from "light-bolt11-decoder";

import { isAllowedHostname } from "@/lib/lightning/host";

export type LnurlPayParams = {
  tag: "payRequest";
  callback: string;
  minSendable: number;
  maxSendable: number;
  commentAllowed?: number;
};

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const n = Number(value);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

export function parsePayParams(json: unknown): LnurlPayParams | null {
  if (json == null || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  if (obj.tag !== "payRequest") return null;
  if (typeof obj.callback !== "string" || !obj.callback.trim()) return null;

  const minSendable = parsePositiveInt(obj.minSendable);
  const maxSendable = parsePositiveInt(obj.maxSendable);
  if (minSendable == null || maxSendable == null || minSendable > maxSendable) return null;

  const result: LnurlPayParams = {
    tag: "payRequest",
    callback: obj.callback.trim(),
    minSendable,
    maxSendable,
  };

  if (obj.commentAllowed != null) {
    const commentAllowed = parsePositiveInt(obj.commentAllowed);
    if (commentAllowed == null) return null;
    result.commentAllowed = commentAllowed;
  }

  return result;
}

export function validateCallbackUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.port && parsed.port !== "443") return false;
  if (!isAllowedHostname(parsed.hostname)) return false;

  return true;
}

function invoiceAmountMsat(invoice: string): bigint | null {
  try {
    const sections = decode(invoice).sections as Array<{
      name: string;
      value?: string | number;
    }>;

    for (const section of sections) {
      if (section.name !== "amount" || section.value == null) continue;
      const msat = BigInt(String(section.value));
      return msat > 0n ? msat : null;
    }

    return null;
  } catch {
    return null;
  }
}

export function verifyInvoiceAmount(invoice: string, amountMsat: bigint): boolean {
  const decoded = invoiceAmountMsat(invoice.trim());
  if (decoded == null) return false;
  return decoded === amountMsat;
}

export function parseVerifyResponse(json: unknown): { settled: boolean } | null {
  if (json == null || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  if (obj.status !== "OK") return null;
  if (typeof obj.settled !== "boolean") return null;
  return { settled: obj.settled };
}

export function parseInvoiceResponse(json: unknown): { pr: string; verifyUrl?: string } | null {
  if (json == null || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj.pr !== "string" || !obj.pr.trim()) return null;

  const result: { pr: string; verifyUrl?: string } = { pr: obj.pr.trim() };
  if (typeof obj.verify === "string" && obj.verify.trim()) {
    result.verifyUrl = obj.verify.trim();
  }
  return result;
}

export function appendLnurlCallbackQuery(
  callback: string,
  params: { amountMsat: bigint; comment?: string },
): string {
  const url = new URL(callback);
  url.searchParams.set("amount", params.amountMsat.toString());
  if (params.comment) {
    url.searchParams.set("comment", params.comment);
  }
  return url.toString();
}
