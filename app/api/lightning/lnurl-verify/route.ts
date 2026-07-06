import { NextResponse } from "next/server";

import { guardedJsonFetch } from "@/lib/lightning/guarded-fetch";
import { parseVerifyResponse, validateCallbackUrl } from "@/lib/lightning/lnurl";

type LnurlVerifyRequest = {
  verifyUrl?: string;
};

export async function POST(req: Request) {
  let body: LnurlVerifyRequest;
  try {
    body = (await req.json()) as LnurlVerifyRequest;
  } catch {
    return NextResponse.json({ settled: false });
  }

  const verifyUrl = typeof body.verifyUrl === "string" ? body.verifyUrl.trim() : "";
  if (!verifyUrl || !validateCallbackUrl(verifyUrl)) {
    return NextResponse.json({ settled: false });
  }

  const json = await guardedJsonFetch(verifyUrl);
  const parsed = parseVerifyResponse(json);
  if (!parsed) {
    return NextResponse.json({ settled: false });
  }

  return NextResponse.json({ settled: parsed.settled });
}
