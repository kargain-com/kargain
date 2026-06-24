import { createHmac, timingSafeEqual } from "node:crypto";

import { appUrl } from "@/lib/config/app-url";

export const SIWE_SESSION_COOKIE = "kargain_siwe_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 7;

export type SiweSession = {
  address: string;
  chainId: number;
  exp: number;
};

function sessionSecret(): string {
  return process.env.SIWE_SESSION_SECRET ?? `${appUrl()}:kargain-siwe-v1`;
}

function signPayload(payloadB64: string): string {
  return createHmac("sha256", sessionSecret()).update(payloadB64).digest("base64url");
}

export function buildSiweSessionCookie(address: string, chainId: number): {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "lax";
    path: string;
    maxAge: number;
  };
} {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload = Buffer.from(
    JSON.stringify({ address: address.toLowerCase(), chainId, exp }),
    "utf8",
  ).toString("base64url");
  const sig = signPayload(payload);
  return {
    name: SIWE_SESSION_COOKIE,
    value: `${payload}.${sig}`,
    options: siweCookieOptions(SESSION_TTL_SEC),
  };
}

type SiweSessionCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

function siweCookieOptions(maxAge: number): SiweSessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}

export function buildClearSiweSessionCookie(): {
  name: string;
  value: string;
  options: SiweSessionCookieOptions;
} {
  return {
    name: SIWE_SESSION_COOKIE,
    value: "",
    options: siweCookieOptions(0),
  };
}

export function siweSessionMatches(
  session: SiweSession | null,
  address: string,
  chainId: number,
): boolean {
  if (!session) return false;
  return session.address === address.toLowerCase() && session.chainId === chainId;
}

export function parseSiweSessionCookie(raw: string | undefined | null): SiweSession | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = signPayload(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as SiweSession;
    if (
      typeof parsed.address !== "string" ||
      typeof parsed.chainId !== "number" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return { ...parsed, address: parsed.address.toLowerCase() };
  } catch {
    return null;
  }
}
