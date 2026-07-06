import { NextResponse } from "next/server";

import { guardedJsonFetch } from "@/lib/lightning/guarded-fetch";
import {
  appendLnurlCallbackQuery,
  parseInvoiceResponse,
  parsePayParams,
  validateCallbackUrl,
  verifyInvoiceAmount,
} from "@/lib/lightning/lnurl";
import { lud16WellKnownUrl, parseLud16 } from "@/lib/lightning/lud16";

type LnurlPayRequest = {
  address?: string;
  amountMsat?: string;
  comment?: string;
};

function parseAmountMsat(raw: string | undefined): bigint | null {
  if (raw == null || !/^\d+$/.test(raw.trim())) return null;
  try {
    const value = BigInt(raw.trim());
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: LnurlPayRequest;
  try {
    body = (await req.json()) as LnurlPayRequest;
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const address = typeof body.address === "string" ? body.address.trim() : "";
  const parsed = parseLud16(address);
  if (!parsed) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }

  const amountMsat = parseAmountMsat(body.amountMsat);
  if (amountMsat == null) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }

  const wellKnownUrl = lud16WellKnownUrl(parsed.name, parsed.domain);
  const payParamsJson = await guardedJsonFetch(wellKnownUrl);
  const payParams = parsePayParams(payParamsJson);
  if (!payParams || !validateCallbackUrl(payParams.callback)) {
    return NextResponse.json({ error: "invalid_provider_response" }, { status: 502 });
  }

  const amountNum = Number(amountMsat);
  if (
    !Number.isSafeInteger(amountNum) ||
    amountNum < payParams.minSendable ||
    amountNum > payParams.maxSendable
  ) {
    return NextResponse.json(
      {
        error: "amount_out_of_range",
        minSendable: payParams.minSendable,
        maxSendable: payParams.maxSendable,
      },
      { status: 400 },
    );
  }

  const comment =
    typeof body.comment === "string" && body.comment.trim() ? body.comment.trim() : undefined;
  if (comment && payParams.commentAllowed != null && comment.length > payParams.commentAllowed) {
    return NextResponse.json({ error: "comment_too_long" }, { status: 400 });
  }

  const callbackUrl = appendLnurlCallbackQuery(payParams.callback, {
    amountMsat,
    comment:
      comment && payParams.commentAllowed != null && comment.length <= payParams.commentAllowed
        ? comment
        : undefined,
  });

  const invoiceJson = await guardedJsonFetch(callbackUrl);
  const invoice = parseInvoiceResponse(invoiceJson);
  if (!invoice) {
    return NextResponse.json({ error: "invalid_provider_response" }, { status: 502 });
  }

  if (!verifyInvoiceAmount(invoice.pr, amountMsat)) {
    return NextResponse.json({ error: "invoice_amount_mismatch" }, { status: 502 });
  }

  const verifyUrl =
    invoice.verifyUrl && validateCallbackUrl(invoice.verifyUrl) ? invoice.verifyUrl : undefined;

  return NextResponse.json({
    invoice: invoice.pr,
    ...(verifyUrl ? { verifyUrl } : {}),
  });
}
