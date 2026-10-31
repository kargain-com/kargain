/**
 * Sole Solana JSON-RPC fetch helper for product + svm-ingest.
 * Stays outside @solana/web3.js response schemas (those reject transaction version 1).
 * Every call requires an explicit per-request time bound (no hidden default).
 */

type JsonRpcSuccess<T> = { jsonrpc: "2.0"; id: number; result: T };
type JsonRpcFailure = {
  jsonrpc: "2.0";
  id: number;
  error: { code: number; message: string };
};

export type SolanaJsonRpcPost = <T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs: number,
) => Promise<T>;

/**
 * Classify transport failures only — never by message text.
 * Answered HTTP / JSON-RPC errors from {@link postSolanaJsonRpc} are plain
 * `Error`s and are not unreachable, even when the RPC text says "network".
 *
 * Unreachable: `DOMException` named `TimeoutError`/`AbortError`, and the
 * `TypeError` `fetch` throws on network failure (follow `cause`).
 */
export function isSolanaRpcUnreachableError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === "TimeoutError" || err.name === "AbortError";
  }
  if (err instanceof TypeError) {
    // fetch network failure (`TypeError: fetch failed`, often with a `cause`).
    return true;
  }
  return false;
}

export const postSolanaJsonRpc: SolanaJsonRpcPost = async <T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<T> => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Solana RPC request failed: ${response.status}`);
  }
  const body = (await response.json()) as JsonRpcSuccess<T> | JsonRpcFailure;
  if ("error" in body) {
    const err = new Error(
      `Solana RPC ${method} failed: ${body.error.message}`,
    ) as Error & { code?: number };
    err.code = body.error.code;
    throw err;
  }
  return body.result;
};
