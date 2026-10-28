/**
 * Deploy preflight for svm-ingest (ADR 0012): build runtime, then check every
 * followed program account exists and is executable. Prints only ADR §4
 * `deploy_preflight` lines — never URLs, messages, or `deploy_evidence`.
 */
import {
  buildSvmIngestRuntime,
  SvmIngestRuntimeRefusalError,
  type FollowedProgram,
  type SvmIngestRuntime,
} from "../lib/svm/ingest-config.js";
import {
  isSolanaRpcUnreachableError,
  postSolanaJsonRpc,
  type SolanaJsonRpcPost,
} from "../lib/svm/solana-json-rpc.js";
import {
  createDeployPreflightPrinter,
  type DeployPreflightPrinter,
  type DeployPreflightWriter,
  type SvmProgramPreflightVerdict,
} from "./lib/deploy-preflight-output.js";

/** Per-request bound for program account checks (ADR 0012). */
export const SVM_INGEST_PREFLIGHT_TIMEOUT_MS = 10_000;

type AccountInfoInner = {
  executable?: boolean;
  data?: unknown;
  owner?: string;
};

export type SvmProgramCheckVerdict = SvmProgramPreflightVerdict;

export type SvmIngestDeployPreflightDeps = {
  env?: NodeJS.ProcessEnv;
  buildRuntime?: (env: NodeJS.ProcessEnv) => SvmIngestRuntime;
  postRpc?: SolanaJsonRpcPost;
  stdoutWrite?: DeployPreflightWriter;
};

async function checkProgram(
  rpcUrl: string,
  program: FollowedProgram,
  postRpc: SolanaJsonRpcPost,
): Promise<SvmProgramCheckVerdict> {
  try {
    const result = await postRpc<{ value: AccountInfoInner | null }>(
      rpcUrl,
      "getAccountInfo",
      [program.programId, { encoding: "base64", commitment: "confirmed" }],
      SVM_INGEST_PREFLIGHT_TIMEOUT_MS,
    );
    if (result == null || result.value == null) {
      return "account_missing";
    }
    if (result.value.executable !== true) {
      return "not_executable";
    }
    return "ok";
  } catch (err) {
    if (isSolanaRpcUnreachableError(err)) {
      return "unreachable";
    }
    // Answered HTTP / JSON-RPC error — not unreachable; outer catch → preflight_error.
    throw err;
  }
}

function reasonForVerdict(
  verdict: Exclude<SvmProgramCheckVerdict, "ok">,
): string {
  switch (verdict) {
    case "account_missing":
      return "program_account_missing";
    case "not_executable":
      return "program_not_executable";
    case "unreachable":
      return "program_check_unreachable";
  }
}

/**
 * Run the svm-ingest deploy preflight. Returns process exit code (0 = ok).
 */
export async function runSvmIngestDeployPreflight(
  deps?: SvmIngestDeployPreflightDeps,
): Promise<number> {
  const print = createDeployPreflightPrinter(deps?.stdoutWrite);
  const env = deps?.env ?? process.env;
  const build = deps?.buildRuntime ?? buildSvmIngestRuntime;
  const postRpc = deps?.postRpc ?? postSolanaJsonRpc;

  try {
    const rt = build(env);
    let refusedReason: string | undefined;
    for (const program of rt.followedPrograms) {
      const verdict = await checkProgram(rt.rpcUrl, program, postRpc);
      print.svmProgram({
        evidenceKey: program.evidenceKey,
        verdict,
      });
      if (verdict !== "ok" && refusedReason === undefined) {
        refusedReason = reasonForVerdict(verdict);
      }
    }
    if (refusedReason !== undefined) {
      print.refused("svm-ingest", refusedReason);
      return 1;
    }
    return 0;
  } catch (err) {
    return refuseSvmIngest(err, print);
  }
}

function refuseSvmIngest(
  err: unknown,
  print: DeployPreflightPrinter,
): number {
  if (err instanceof SvmIngestRuntimeRefusalError) {
    print.refused("svm-ingest", err.code);
    return 1;
  }
  print.refused("svm-ingest", "preflight_error");
  return 1;
}

function isExecutedAsCli(): boolean {
  const entry = process.argv[1];
  if (entry == null) return false;
  return /svm-ingest-deploy-preflight\.(ts|js|mjs|cjs)$/.test(entry);
}

if (isExecutedAsCli()) {
  runSvmIngestDeployPreflight()
    .then((code) => process.exit(code))
    .catch((err) => {
      refuseSvmIngest(err, createDeployPreflightPrinter());
      process.exit(1);
    });
}
