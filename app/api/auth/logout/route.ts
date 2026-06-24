import { NextResponse } from "next/server";

import { buildClearSiweSessionCookie } from "@/lib/auth/siwe-session";

/** Clear the SIWE session cookie (wallet disconnect companion). */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  const cookie = buildClearSiweSessionCookie();
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}
