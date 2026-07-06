export type LnurlPaySuccess = {
  invoice: string;
  verifyUrl?: string;
};

export type LnurlPayErrorCode =
  | "invalid_address"
  | "invalid_amount"
  | "amount_out_of_range"
  | "invalid_provider_response"
  | "invoice_amount_mismatch"
  | "comment_too_long"
  | "invalid_payload"
  | "network";

export type LnurlPayError = {
  code: LnurlPayErrorCode;
  minSendable?: number;
  maxSendable?: number;
};

export async function fetchLnurlPayInvoice(input: {
  address: string;
  amountMsat: bigint;
  comment?: string;
}): Promise<{ ok: true; data: LnurlPaySuccess } | { ok: false; error: LnurlPayError }> {
  try {
    const res = await fetch("/api/lightning/lnurl-pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: input.address,
        amountMsat: input.amountMsat.toString(),
        comment: input.comment,
      }),
    });

    const json = (await res.json()) as {
      invoice?: string;
      verifyUrl?: string;
      error?: string;
      minSendable?: number;
      maxSendable?: number;
    };

    if (!res.ok) {
      const code = (json.error ?? "network") as LnurlPayErrorCode;
      return {
        ok: false,
        error: {
          code,
          minSendable: json.minSendable,
          maxSendable: json.maxSendable,
        },
      };
    }

    if (typeof json.invoice !== "string" || !json.invoice.trim()) {
      return { ok: false, error: { code: "invalid_provider_response" } };
    }

    return {
      ok: true,
      data: {
        invoice: json.invoice,
        verifyUrl: typeof json.verifyUrl === "string" ? json.verifyUrl : undefined,
      },
    };
  } catch {
    return { ok: false, error: { code: "network" } };
  }
}

export function lnurlPayErrorMessage(error: LnurlPayError): string {
  switch (error.code) {
    case "invalid_address":
      return "Lightning address is not valid.";
    case "amount_out_of_range": {
      const minSats =
        error.minSendable != null ? Math.ceil(error.minSendable / 1000) : null;
      const maxSats =
        error.maxSendable != null ? Math.floor(error.maxSendable / 1000) : null;
      if (minSats != null && maxSats != null) {
        return `Amount must be between ${minSats.toLocaleString("en-US")} and ${maxSats.toLocaleString("en-US")} sats for this provider.`;
      }
      return "Amount is outside the range this provider accepts.";
    }
    case "invoice_amount_mismatch":
      return "Invoice did not match the expected amount. Try again.";
    case "invalid_provider_response":
      return "Could not reach the Lightning provider. Try again.";
    default:
      return "Could not load Lightning invoice. Try again.";
  }
}

export async function fetchLnurlVerifySettled(verifyUrl: string): Promise<boolean> {
  try {
    const res = await fetch("/api/lightning/lnurl-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verifyUrl }),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { settled?: boolean };
    return json.settled === true;
  } catch {
    return false;
  }
}
