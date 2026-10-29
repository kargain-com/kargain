/**
 * Read-only lag sampler for ADR 0014 §e.
 * lag_seconds = head.timestamp − status[chain].block.timestamp (clamped at 0).
 * Chain names come from ponder-env (C4) — never a local duplicate map.
 */
import { appendFileSync } from "node:fs";
import {
  ponderStatusChainNameById,
  resolveCommercialRpcUrls,
} from "./lib/ponder-env.js";
import {
  SEPOLIA_CHAIN_ID,
  SPOKE_CHAIN_ID,
} from "./lib/load-deployment.js";
import { LOCALHOST_CHAIN_ID } from "../lib/web3/local-chain.js";

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

type StatusPayload = Record<
  string,
  { block?: { number?: number; timestamp?: number } }
>;

async function ethGetLatestTimestamp(rpcUrl: string): Promise<number> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    }),
  });
  if (!res.ok) {
    throw new Error(`rpc_http_${res.status}`);
  }
  const body = (await res.json()) as {
    result?: { timestamp?: string };
    error?: { message?: string };
  };
  if (body.error) {
    throw new Error(body.error.message ?? "rpc_error");
  }
  const hex = body.result?.timestamp;
  if (!hex) throw new Error("rpc_missing_timestamp");
  return Number.parseInt(hex, 16);
}

async function sampleChain(
  ponderUrl: string,
  chainId: number,
  chainName: string,
): Promise<{ chainId: number; lag_seconds: number; at: string }> {
  const statusUrl = `${ponderUrl.replace(/\/$/, "")}/status`;
  const statusRes = await fetch(statusUrl);
  if (!statusRes.ok) {
    throw new Error(`status_http_${statusRes.status}`);
  }
  const status = (await statusRes.json()) as StatusPayload;
  const named = status[chainName];
  const blockTs = named?.block?.timestamp;
  if (blockTs === undefined) {
    throw new Error(`status_missing_chain_${chainId}`);
  }

  let headTs: number;
  if (chainId === LOCALHOST_CHAIN_ID) {
    const rpc = process.env.PONDER_RPC_URL_31337 ?? "http://127.0.0.1:8545";
    headTs = await ethGetLatestTimestamp(rpc);
  } else {
    const rpcs = resolveCommercialRpcUrls(chainId);
    headTs = await ethGetLatestTimestamp(rpcs[0]!);
  }
  const lag = Math.max(0, headTs - blockTs);
  if (!Number.isFinite(lag) || lag < 0) {
    throw new Error(`invalid_lag_seconds_${lag}`);
  }
  return {
    chainId,
    lag_seconds: lag,
    at: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const ponderUrl = argValue(argv, "--ponder-url");
  const out = argValue(argv, "--out");
  if (!ponderUrl || !out) {
    process.stderr.write(
      "usage: ponder-lag-sample --ponder-url <url> --out <file>\n",
    );
    process.exit(2);
  }
  const nameById = ponderStatusChainNameById();
  const chains = Object.keys(nameById).map(Number);
  if (chains.length === 0) {
    // Default commercial pair when env not local-only
    chains.push(SEPOLIA_CHAIN_ID, SPOKE_CHAIN_ID);
  }
  const sampleAt = new Date().toISOString();
  const lines: unknown[] = [];
  for (const chainId of chains) {
    const name = nameById[chainId] ?? ponderStatusChainNameById()[chainId];
    if (!name) continue;
    const row = await sampleChain(ponderUrl, chainId, name);
    lines.push({ ...row, sampleAt });
  }
  for (const row of lines) {
    appendFileSync(out, `${JSON.stringify(row)}\n`, "utf8");
  }
  process.stdout.write(`sampled ${lines.length} chains -> ${out}\n`);
}

main().catch((err) => {
  process.stderr.write(
    `ponder-lag-sample failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
