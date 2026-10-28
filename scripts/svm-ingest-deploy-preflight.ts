/**
 * Deploy preflight for svm-ingest (ADR 0012): build runtime, then check every
 * followed program account exists and is executable. ADR §4 lines only.
 */
import {
  buildSvmIngestRuntime,
  SvmIngestRuntimeRefusalError,
  type FollowedProgram,
  type SvmIngestRuntime,
} from "../lib/svm/ingest-config.js";
import {
  postSolanaJsonRpc,
  type SolanaJsonRpcPost,
} from "../lib/svm/solana-json-rpc.js";
import { printRefusal } from "./lib/deploy-preflight-output.js";

/** Per-request bound for program account checks (ADR 0012). */
export const SVM_INGEST_PREFLIGHT_TIMEOUT_MS = 10_000;

type AccountInfoInner = {
  executable?: boolean;
  data?: unknown;
  owner?: string;
};

export type SvmProgramCheckVerdict =
  | "ok"
  | "account_missing"
  | "not_executable"
  | "unreachable";

export type SvmIngestDeployPreflightDeps = {
  env?: NodeJS.ProcessEnv;
  buildRuntime?: (env: NodeJS.ProcessEnv) => SvmIngestRuntime;
  postRpc?: SolanaJsonRpcPost;
  stdoutWrite?: (line: string) => void;
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
  } catch {
    return "unreachable";
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
  const write =
    deps?.stdoutWrite ??
    ((line: string) => {
      process.stdout.write(line);
    });
  const env = deps?.env ?? process.env;
  const build = deps?.buildRuntime ?? buildSvmIngestRuntime;
  const postRpc = deps?.postRpc ?? postSolanaJsonRpc;

  try {
    const rt = build(env);
    let refusedReason: string | undefined;
    for (const program of rt.followedPrograms) {
      const verdict = await checkProgram(rt.rpcUrl, program, postRpc);
      write(
        `deploy_preflight service=svm-ingest program=${program.evidenceKey} verdict=${verdict}\n`,
      );
      if (verdict !== "ok" && refusedReason === undefined) {
        refusedReason = reasonForVerdict(verdict);
      }
    }
    if (refusedReason !== undefined) {
      write(
        `deploy_preflight service=svm-ingest verdict=refused reason=${refusedReason}\n`,
      );
      write(`deploy_evidence outcome=refused\n`);
      return 1;
    }
    return 0;
  } catch (err) {
    if (err instanceof SvmIngestRuntimeRefusalError) {
      write(
        `deploy_preflight service=svm-ingest verdict=refused reason=${err.code}\n`,
      );
      write(`deploy_evidence outcome=refused\n`);
      return 1;
    }
    write(
      `deploy_preflight service=svm-ingest verdict=refused reason=preflight_error\n`,
    );
    write(`deploy_evidence outcome=refused\n`);
    return 1;
  }
}

function isExecutedAsCli(): boolean {
  const entry = process.argv[1];
  if (entry == null) return false;
  return /svm-ingest-deploy-preflight\.(ts|js|mjs|cjs)$/.test(entry);
}

if (isExecutedAsCli()) {
  runSvmIngestDeployPreflight()
    .then((code) => process.exit(code))
    .catch(() => {
      printRefusal("svm-ingest", "preflight_error");
      process.exit(1);
    });
}
