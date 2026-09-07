/**
 * Sole Solana JSON-RPC fetch helper for product + svm-ingest.
 * Stays outside @solana/web3.js response schemas (those reject transaction version 1).
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
) => Promise<T>;

export const postSolanaJsonRpc: SolanaJsonRpcPost = async <T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
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
