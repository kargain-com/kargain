import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { parseSiweSessionCookie, SIWE_SESSION_COOKIE } from "@/lib/auth/siwe-session";

/** Return the current SIWE session when the httpOnly cookie is valid. */
export async function GET() {
  const jar = await cookies();
  const session = parseSiweSessionCookie(jar.get(SIWE_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    address: session.address,
    chainId: session.chainId,
    exp: session.exp,
  });
}
