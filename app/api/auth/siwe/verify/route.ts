import { NextResponse } from "next/server";
import { SiweMessage } from "siwe";

import { buildSiweSessionCookie } from "@/lib/auth/siwe-session";

/** Verify a SIWE message + signature after wallet login. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { message: string; signature: string };
    if (!body?.message || !body?.signature) {
      return NextResponse.json({ ok: false, error: "message and signature required" }, { status: 400 });
    }

    const siwe = new SiweMessage(body.message);
    const result = await siwe.verify({ signature: body.signature });

    if (!result.success) {
      return NextResponse.json({ ok: false, error: result.error?.type ?? "verify_failed" }, { status: 401 });
    }

    const res = NextResponse.json({
      ok: true,
      address: result.data.address,
      chainId: result.data.chainId,
    });
    const cookie = buildSiweSessionCookie(result.data.address, result.data.chainId);
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }
}
