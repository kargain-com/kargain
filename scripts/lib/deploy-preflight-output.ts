/**
 * Sole owner of ADR 0012 §4 `deploy_preflight …` line formats.
 * Never prints URLs, error messages, or `deploy_evidence` (workflow owns evidence).
 */

export type DeployPreflightService = "ponder" | "svm-ingest";

export type DeployPreflightWriter = (line: string) => void;

export type SvmProgramPreflightVerdict =
  | "ok"
  | "account_missing"
  | "not_executable"
  | "unreachable";

const defaultWrite: DeployPreflightWriter = (line) => {
  process.stdout.write(line);
};

/** Injectable printer for every `deploy_preflight` line the ADR names. */
export function createDeployPreflightPrinter(
  write: DeployPreflightWriter = defaultWrite,
) {
  return {
    ponderProvider(opts: {
      chainId: number;
      providerIndex: number;
      verdict: string;
    }): void {
      write(
        `deploy_preflight service=ponder chain=${opts.chainId} provider=${opts.providerIndex} verdict=${opts.verdict}\n`,
      );
    },
    svmProgram(opts: {
      evidenceKey: string;
      verdict: SvmProgramPreflightVerdict;
    }): void {
      write(
        `deploy_preflight service=svm-ingest program=${opts.evidenceKey} verdict=${opts.verdict}\n`,
      );
    },
    /** `key=` names the env key for the ADR 0016 §a env refusals. */
    refused(
      service: DeployPreflightService,
      reason: string,
      key?: string,
    ): void {
      const keyField = key === undefined ? "" : ` key=${key}`;
      write(
        `deploy_preflight service=${service} verdict=refused reason=${reason}${keyField}\n`,
      );
    },
  };
}

export type DeployPreflightPrinter = ReturnType<
  typeof createDeployPreflightPrinter
>;
