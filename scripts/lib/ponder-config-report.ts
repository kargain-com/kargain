/**
 * Read-only commercial stack + transport report for `pnpm ponder:config`.
 * Transport goes through ponder-env owners only; never prints a URL.
 */
import { commercialNetworkLabel } from "../../lib/web3/chain-selector-state.js";
import {
  buildPonderIndexingConfig,
  PonderEnvRefusalError,
  resolveCommercialRpcUrls,
  resolveGetLogsBlockRange,
} from "./ponder-env.js";
import {
  resolveCommercialStack,
  type ResolvedCommercialStack,
} from "./resolve-sepolia-stack.js";

export type PonderConfigReport = {
  lines: string[];
  ok: boolean;
};

function stackLines(label: string, stack: ResolvedCommercialStack): string[] {
  return [
    `${label} (${stack.chainId})`,
    `  indexFromBlock: ${stack.indexFromBlock}`,
    `  karPassport:    ${stack.karPassport}`,
    `  fixedPrice:     ${stack.fixedPriceConsignment ?? "(none — Nuclear #2)"}`,
    `  ascending:      ${stack.ascendingConsignment ?? "(none — Nuclear #2)"}`,
    `  gateway:        ${stack.bridgeGateway}`,
  ];
}

function transportLines(
  chainId: number,
  env: NodeJS.ProcessEnv,
): { lines: string[]; ok: boolean } {
  const lines: string[] = [];
  let ok = true;

  try {
    const urls = resolveCommercialRpcUrls(chainId, env);
    lines.push(`  PONDER_RPC_URLS_${chainId}: ${urls.length} providers`);
  } catch (err) {
    ok = false;
    if (err instanceof PonderEnvRefusalError) {
      lines.push(`  ${err.code} ${err.envKey}`);
    } else {
      throw err;
    }
  }

  try {
    const window = resolveGetLogsBlockRange(chainId, env);
    lines.push(`  PONDER_GETLOGS_BLOCK_RANGE_${chainId}: ${window}`);
  } catch (err) {
    ok = false;
    if (err instanceof PonderEnvRefusalError) {
      lines.push(`  ${err.code} ${err.envKey}`);
    } else {
      throw err;
    }
  }

  return { lines, ok };
}

/**
 * Registry stacks + commercial transport for the same chain set as
 * `buildPonderRuntime` (localhost excluded). Pass `env` into both transport
 * owners so tests never touch `process.env`.
 */
export function formatPonderConfigReport(
  env: NodeJS.ProcessEnv = process.env,
): PonderConfigReport {
  const lines: string[] = [
    "Kargain commercial stacks (COMMERCIAL_ACTIVE in lib/web3/commercial-active.ts)",
    "===============================================================================",
    "",
  ];
  let ok = true;

  const indexing = buildPonderIndexingConfig();
  for (const [name, chain] of Object.entries(indexing.chains)) {
    if (name === "localhost") continue;

    const named = commercialNetworkLabel(chain.id);
    if (!named.ok) {
      throw new Error(
        `commercialNetworkLabel refused for ${chain.id}: ${named.cause}`,
      );
    }
    const stack = resolveCommercialStack(chain.id);
    lines.push(...stackLines(named.label, stack));

    const transport = transportLines(chain.id, env);
    lines.push(...transport.lines);
    if (!transport.ok) ok = false;
    lines.push("");
  }

  lines.push(
    "Start blocks and addresses come from the registry only (ADR 0016 §a).",
    "A change ships as a reviewed registry change; the deploy switches schemas.",
  );

  return { lines, ok };
}
