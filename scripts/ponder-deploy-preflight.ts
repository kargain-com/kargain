/**
 * Deploy preflight for ponder (ADR 0012): evaluate ponder.config.ts, then probe
 * every commercial RPC provider. Prints only ADR §4 `deploy_preflight` lines —
 * never URLs, messages, or `deploy_evidence` (workflow owns evidence).
 */
import { PonderEnvRefusalError } from "./lib/ponder-env.js";
import {
  ponderRpcProbeVerdictRefusesDeploy,
  probeAllCommercialPonderRpcs,
  type PonderRpcProbeDeps,
} from "./lib/ponder-rpc-probe.js";
import {
  createDeployPreflightPrinter,
  type DeployPreflightPrinter,
  type DeployPreflightWriter,
} from "./lib/deploy-preflight-output.js";

export type PonderDeployPreflightDeps = PonderRpcProbeDeps & {
  /** Override config evaluation (tests). Default: import ponder.config.ts. */
  evaluateConfig?: () => Promise<unknown>;
  stdoutWrite?: DeployPreflightWriter;
};

async function evaluatePonderConfig(): Promise<unknown> {
  return import("../ponder.config.ts");
}

/**
 * Run the Ponder deploy preflight. Returns process exit code (0 = ok).
 */
export async function runPonderDeployPreflight(
  deps?: PonderDeployPreflightDeps,
): Promise<number> {
  const print = createDeployPreflightPrinter(deps?.stdoutWrite);
  const evaluate = deps?.evaluateConfig ?? evaluatePonderConfig;

  try {
    await evaluate();
    const results = await probeAllCommercialPonderRpcs(deps);
    for (const result of results) {
      result.providers.forEach((p, index) => {
        print.ponderProvider({
          chainId: result.chainId,
          providerIndex: index,
          verdict: p.verdict,
        });
      });
    }
    const refusesDeploy = results.some((r) =>
      r.providers.some((p) => ponderRpcProbeVerdictRefusesDeploy(p.verdict)),
    );
    if (refusesDeploy) {
      print.refused("ponder", "rpc_probe_failed");
      return 1;
    }
    return 0;
  } catch (err) {
    return refusePonder(err, print);
  }
}

function refusePonder(err: unknown, print: DeployPreflightPrinter): number {
  if (err instanceof PonderEnvRefusalError) {
    print.refused("ponder", err.code);
    return 1;
  }
  print.refused("ponder", "preflight_error");
  return 1;
}

function isExecutedAsCli(): boolean {
  const entry = process.argv[1];
  if (entry == null) return false;
  return /ponder-deploy-preflight\.(ts|js|mjs|cjs)$/.test(entry);
}

if (isExecutedAsCli()) {
  runPonderDeployPreflight()
    .then((code) => process.exit(code))
    .catch((err) => {
      refusePonder(err, createDeployPreflightPrinter());
      process.exit(1);
    });
}
