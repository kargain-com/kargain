/**
 * Sole Irys bundler deposit-POST transport.
 * Status class only — never parse response body.
 */

export type IrysBundlerDepositPostClass =
  | "accepted"
  | "not_seen_yet"
  | "bundler_unavailable";

export type IrysBundlerDepositPostResult = {
  statusClass: IrysBundlerDepositPostClass;
  httpStatus: number;
};

/**
 * POST `{bundlerUrl}/account/balance/{token}` with `{ tx_id }`.
 * 200|202 → accepted; 400 → not_seen_yet; else bundler_unavailable.
 */
export async function postIrysBundlerDepositTx(args: {
  bundlerUrl: string;
  token: string;
  txId: string;
  fetchImpl?: typeof fetch;
}): Promise<IrysBundlerDepositPostResult> {
  const base = args.bundlerUrl.replace(/\/$/, "");
  const url = `${base}/account/balance/${args.token}`;
  const fetchImpl = args.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tx_id: args.txId }),
    });
    const httpStatus = res.status;
    if (httpStatus === 200 || httpStatus === 202) {
      return { statusClass: "accepted", httpStatus };
    }
    if (httpStatus === 400) {
      return { statusClass: "not_seen_yet", httpStatus };
    }
    return { statusClass: "bundler_unavailable", httpStatus };
  } catch {
    return { statusClass: "bundler_unavailable", httpStatus: 0 };
  }
}
