/**
 * Read-only lag sampler for ADR 0014 §e.
 * lag_seconds = head.timestamp − status[chain].block.timestamp (clamped at 0).
 * Appends one JSON line per sample to --out.
 *
 * Must run from a built slot image (imports lib/ via ponder-env), not a host mount alone:
 *   docker compose run --rm --no-deps -v <dir>:/samples --entrypoint node ponder-blue \
 *     --import tsx scripts/ponder-lag-sample.ts --ponder-url http://ponder:42069 --out /samples/file.jsonl
 */
import { appendFileSync } from "node:fs";
import { resolveCommercialRpcUrls } from "./lib/ponder-env.js";
import {
  SEPOLIA_CHAIN_ID,
  SPOKE_CHAIN_ID,
} from "./lib/load-deployment.js";

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
): Promise<{ chainId: number; lag_seconds: number; at: string }> {
  const statusUrl = `${ponderUrl.replace(/\/$/, "")}/status`;
  const statusRes = await fetch(statusUrl);
  if (!statusRes.ok) {
    throw new Error(`status_http_${statusRes.status}`);
  }
  const status = (await statusRes.json()) as StatusPayload;
  // Ponder /status keys by chain name; find entry whose block we can read.
  // Prefer numeric chain id key if present; else scan values.
  let blockTs: number | undefined;
  const direct = status[String(chainId)];
  if (direct?.block?.timestamp !== undefined) {
    blockTs = direct.block.timestamp;
  } else {
    for (const v of Object.values(status)) {
      if (v?.block?.timestamp !== undefined) {
        // Match by checking config — for dual commercial we need per-chain.
        // Ponder 0.18 status is keyed by chain name from config.
      }
    }
  }
  // Resolve chain name keys from known commercial ids via status object shapes.
  // baseSepolia / ethereumSepolia are the ponder.config names.
  const nameById: Record<number, string> = {
    [SEPOLIA_CHAIN_ID]: "baseSepolia",
    [SPOKE_CHAIN_ID]: "ethereumSepolia",
  };
  const named = status[nameById[chainId] ?? ""];
  if (named?.block?.timestamp !== undefined) {
    blockTs = named.block.timestamp;
  }
  if (blockTs === undefined) {
    throw new Error(`status_missing_chain_${chainId}`);
  }

  const rpcs = resolveCommercialRpcUrls(chainId);
  const headTs = await ethGetLatestTimestamp(rpcs[0]!);
  const lag = Math.max(0, headTs - blockTs);
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
  const chains = [SEPOLIA_CHAIN_ID, SPOKE_CHAIN_ID];
  const sampleAt = new Date().toISOString();
  const lines: unknown[] = [];
  for (const chainId of chains) {
    const row = await sampleChain(ponderUrl, chainId);
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
