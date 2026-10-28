/**
 * Exact ADR 0012 §4 preflight output lines. Never print URLs or error messages.
 */

export type DeployPreflightService = "ponder" | "svm-ingest";

export function printPonderProviderLine(opts: {
  chainId: number;
  providerIndex: number;
  verdict: string;
}): void {
  process.stdout.write(
    `deploy_preflight service=ponder chain=${opts.chainId} provider=${opts.providerIndex} verdict=${opts.verdict}\n`,
  );
}

export function printSvmProgramLine(opts: {
  evidenceKey: string;
  verdict: "ok" | "account_missing" | "not_executable" | "unreachable";
}): void {
  process.stdout.write(
    `deploy_preflight service=svm-ingest program=${opts.evidenceKey} verdict=${opts.verdict}\n`,
  );
}

export function printRefusal(
  service: DeployPreflightService,
  reason: string,
): void {
  process.stdout.write(
    `deploy_preflight service=${service} verdict=refused reason=${reason}\n`,
  );
  process.stdout.write(`deploy_evidence outcome=refused\n`);
}
