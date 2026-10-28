/**
 * Deploy preflight for ponder (ADR 0012): evaluate ponder.config.ts, then probe
 * every commercial RPC provider. Prints only ADR §4 lines — never URLs or messages.
 */
import { PonderEnvRefusalError } from "./lib/ponder-env.js";
import {
  probeAllCommercialPonderRpcs,
  type PonderRpcProbeDeps,
  type PonderRpcProbeResult,
} from "./lib/ponder-rpc-probe.js";
import { printRefusal } from "./lib/deploy-preflight-output.js";

export type PonderDeployPreflightDeps = PonderRpcProbeDeps & {
  /** Override config evaluation (tests). Default: import ponder.config.ts. */
  evaluateConfig?: () => Promise<unknown>;
  stdoutWrite?: (line: string) => void;
};

async function evaluatePonderConfig(): Promise<unknown> {
  return import("../ponder.config.ts");
}

function emitProviderLines(
  results: PonderRpcProbeResult[],
  write: (line: string) => void,
): void {
  for (const result of results) {
    result.providers.forEach((p, index) => {
      write(
        `deploy_preflight service=ponder chain=${result.chainId} provider=${index} verdict=${p.verdict}\n`,
      );
    });
  }
}

/**
 * Run the Ponder deploy preflight. Returns process exit code (0 = ok).
 */
export async function runPonderDeployPreflight(
  deps?: PonderDeployPreflightDeps,
): Promise<number> {
  const write =
    deps?.stdoutWrite ??
    ((line: string) => {
      process.stdout.write(line);
    });
  const evaluate = deps?.evaluateConfig ?? evaluatePonderConfig;

  try {
    await evaluate();
    const results = await probeAllCommercialPonderRpcs(deps);
    emitProviderLines(results, write);
    const allOk = results.every((r) => r.ok);
    if (!allOk) {
      write(
        `deploy_preflight service=ponder verdict=refused reason=rpc_probe_failed\n`,
      );
      write(`deploy_evidence outcome=refused\n`);
      return 1;
    }
    return 0;
  } catch (err) {
    if (err instanceof PonderEnvRefusalError) {
      write(
        `deploy_preflight service=ponder verdict=refused reason=${err.code}\n`,
      );
      write(`deploy_evidence outcome=refused\n`);
      return 1;
    }
    write(
      `deploy_preflight service=ponder verdict=refused reason=preflight_error\n`,
    );
    write(`deploy_evidence outcome=refused\n`);
    return 1;
  }
}

function isExecutedAsCli(): boolean {
  const entry = process.argv[1];
  if (entry == null) return false;
  return /ponder-deploy-preflight\.(ts|js|mjs|cjs)$/.test(entry);
}

if (isExecutedAsCli()) {
  runPonderDeployPreflight()
    .then((code) => process.exit(code))
    .catch(() => {
      printRefusal("ponder", "preflight_error");
      process.exit(1);
    });
}
