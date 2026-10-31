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
 * Answered HTTP / JSON-RPC / malformed-envelope errors from
 * {@link postSolanaJsonRpc} are plain `Error`s and are not unreachable.
 *
 * Unreachable: `DOMException` named `TimeoutError`/`AbortError`, and the
 * `TypeError` `fetch` throws on network failure (before body parse).
 */
export function isSolanaRpcUnreachableError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === "TimeoutError" || err.name === "AbortError";
  }
  if (err instanceof TypeError) {
    // fetch network failure only — body/parse paths throw plain Error.
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
  // TimeoutError / AbortError / TypeError from fetch propagate as transport.
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
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Solana RPC ${method} returned non-JSON body`);
  }
  if (body == null || typeof body !== "object") {
    throw new Error(`Solana RPC ${method} returned malformed JSON-RPC envelope`);
  }
  const envelope = body as JsonRpcSuccess<T> | JsonRpcFailure;
  if ("error" in envelope) {
    const err = new Error(
      `Solana RPC ${method} failed: ${envelope.error.message}`,
    ) as Error & { code?: number };
    err.code = envelope.error.code;
    throw err;
  }
  if (!("result" in envelope)) {
    throw new Error(`Solana RPC ${method} returned no result field`);
  }
  return envelope.result;
};
