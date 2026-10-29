/**
 * Rehearsal helper: from the local deployment's registry addresses, print
 * PONDER_START_BLOCK_31337 (first registry deployment block) and
 * PONDER_GETLOGS_BLOCK_RANGE_31337 (window covering all registry deploys).
 * No probe special case — values feed the shared env owner.
 */
import { ponderLocalAddresses } from "./lib/load-deployment.js";

const RPC = process.env.PONDER_RPC_URL_31337?.trim() || "http://127.0.0.1:8545";

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`rpc http ${res.status}`);
  const body = (await res.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (body.error) throw new Error(body.error.message ?? "rpc error");
  return body.result as T;
}

async function codeAt(address: string, block: number): Promise<string> {
  return rpc<string>("eth_getCode", [address, `0x${block.toString(16)}`]);
}

/** Lowest block where eth_getCode is non-empty (Hardhat local deploys). */
async function creationBlock(address: string, tip: number): Promise<number> {
  const tipCode = await codeAt(address, tip);
  if (!tipCode || tipCode === "0x") {
    throw new Error(`no code for ${address} at tip ${tip}`);
  }
  let lo = 0;
  let hi = tip;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const code = await codeAt(address, mid);
    if (code && code !== "0x") hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

async function main(): Promise<void> {
  const local = ponderLocalAddresses();
  const addresses = [
    local.karPassport,
    local.karProPass,
    local.karProStaking,
    ...(local.bridgeGateway ? [local.bridgeGateway] : []),
    ...(local.fixedPriceConsignment ? [local.fixedPriceConsignment] : []),
    ...(local.ascendingConsignment ? [local.ascendingConsignment] : []),
  ];
  const tipHex = await rpc<string>("eth_blockNumber", []);
  const tip = Number.parseInt(tipHex, 16);
  const blocks: number[] = [];
  for (const addr of addresses) {
    blocks.push(await creationBlock(addr, tip));
  }
  const start = Math.min(...blocks);
  const end = Math.max(...blocks);
  const window = end - start + 1;
  if (!Number.isFinite(start) || window <= 0) {
    throw new Error(`invalid start/window start=${start} window=${window}`);
  }
  process.stdout.write(
    `export PONDER_START_BLOCK_31337=${start}\n` +
      `export PONDER_GETLOGS_BLOCK_RANGE_31337=${window}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
