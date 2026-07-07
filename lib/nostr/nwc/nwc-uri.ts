import { isAllowedHostname } from "@/lib/lightning/host";

export type ParsedNwcConnection = {
  walletPubkey: string;
  relayUrl: string;
  secretHex: string;
};

const SCHEME_SLASH = "nostr+walletconnect://";
const SCHEME = "nostr+walletconnect:";

const HEX64 = /^[0-9a-f]{64}$/;

function stripScheme(value: string): string | null {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith(SCHEME_SLASH)) {
    return trimmed.slice(SCHEME_SLASH.length);
  }
  if (lower.startsWith(SCHEME)) {
    const rest = trimmed.slice(SCHEME.length);
    return rest.startsWith("//") ? rest.slice(2) : rest;
  }
  return null;
}

function parseRelayParam(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "wss:") return null;
    if (!isAllowedHostname(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function pickFirstValidRelay(params: URLSearchParams): string | null {
  for (const relay of params.getAll("relay")) {
    const trimmed = relay.trim();
    if (!trimmed) continue;
    const parsed = parseRelayParam(trimmed);
    if (parsed) return parsed;
  }
  return null;
}

export function parseNwcUri(value: string): ParsedNwcConnection | null {
  try {
    const rest = stripScheme(value);
    if (!rest) return null;

    const qIdx = rest.indexOf("?");
    const pubkeyRaw = (qIdx >= 0 ? rest.slice(0, qIdx) : rest).trim();
    const query = qIdx >= 0 ? rest.slice(qIdx + 1) : "";

    const walletPubkey = pubkeyRaw.toLowerCase();
    if (!HEX64.test(walletPubkey)) return null;

    const params = new URLSearchParams(query);
    const secretRaw = params.get("secret")?.trim().toLowerCase() ?? "";
    if (!HEX64.test(secretRaw)) return null;

    const relayUrl = pickFirstValidRelay(params);
    if (!relayUrl) return null;

    return { walletPubkey, relayUrl, secretHex: secretRaw };
  } catch {
    return null;
  }
}
