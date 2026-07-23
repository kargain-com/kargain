"use server";

import type { IndexerBlockNumberResult } from "@/lib/web3/tx-sync";
import { ponderBaseUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function blockNumberForChain(raw: unknown, chainId: number): number | null {
  if (!Number.isSafeInteger(chainId) || chainId < 0 || !isRecord(raw)) {
    return null;
  }

  const matches: number[] = [];
  for (const value of Object.values(raw)) {
    if (!isRecord(value) || value.id !== chainId || !isRecord(value.block)) {
      continue;
    }

    const blockNumber = value.block.number;
    if (
      typeof blockNumber === "number" &&
      Number.isSafeInteger(blockNumber) &&
      blockNumber >= 0
    ) {
      matches.push(blockNumber);
    }
  }

  return matches.length === 1 ? matches[0]! : null;
}

export async function getIndexerBlockNumber(
  chainId: number,
): Promise<IndexerBlockNumberResult> {
  try {
    const response = await ponderFetch(`${ponderBaseUrl()}/status`);
    if (!response.ok) return { ok: false };

    const blockNumber = blockNumberForChain(await response.json(), chainId);
    return blockNumber === null
      ? { ok: false }
      : { ok: true, blockNumber };
  } catch {
    return { ok: false };
  }
}
