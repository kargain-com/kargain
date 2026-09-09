/**
 * Sole owner: partition `test:verify` into CI-runnable vs deploy-machine suites.
 *
 * Predicate for deploy-machine: the suite's RESULT depends on the presence of
 * gitignored `deployments/` (live-manifest green path, or vacuous green when
 * the directory is absent). CI must never run those.
 *
 * `test:ci` is derived from this module — never a second hand-maintained file list.
 */

export const VERIFY_SCRIPT_NAME = "test:verify" as const;

/**
 * Suites whose green (or vacuous-green) outcome depends on `deployments/` being
 * present on the machine. Today: live N7/SVM manifest match only.
 */
export const DEPLOY_MACHINE_VERIFY_SUITES = [
  "test/commercial-active-manifest-policy.test.ts",
] as const;

export type DeployMachineVerifySuite =
  (typeof DEPLOY_MACHINE_VERIFY_SUITES)[number];

const TEST_FILE_RE = /test\/[^\s]+\.test\.ts/g;

export function parseTestFilesFromScriptBody(scriptBody: string): string[] {
  const matches = scriptBody.match(TEST_FILE_RE);
  return matches ?? [];
}

export function parseVerifyMembers(
  scripts: Record<string, string>,
): string[] {
  const body = scripts[VERIFY_SCRIPT_NAME];
  if (body == null) {
    throw new Error(`package.json scripts missing ${VERIFY_SCRIPT_NAME}`);
  }
  return parseTestFilesFromScriptBody(body);
}

export function isDeployMachineVerifySuite(rel: string): boolean {
  return (DEPLOY_MACHINE_VERIFY_SUITES as readonly string[]).includes(rel);
}

/** `test:verify` members that CI may run (verify ∖ deploy-machine enumerator). */
export function ciVerifyMembers(scripts: Record<string, string>): string[] {
  return parseVerifyMembers(scripts).filter(
    (f) => !isDeployMachineVerifySuite(f),
  );
}

export type VerifyPartitionHole = {
  file: string;
  reason: "in_neither" | "in_both";
};

/**
 * Bidirectional partition: every verify member is in CI xor enumerator;
 * intersection empty; union = verify.
 */
export function findVerifyPartitionHoles(
  scripts: Record<string, string>,
): VerifyPartitionHole[] {
  const verify = new Set(parseVerifyMembers(scripts));
  const ci = new Set(ciVerifyMembers(scripts));
  const machine = new Set<string>(DEPLOY_MACHINE_VERIFY_SUITES);
  const holes: VerifyPartitionHole[] = [];

  for (const file of verify) {
    const inCi = ci.has(file);
    const inMachine = machine.has(file);
    if (inCi === inMachine) {
      holes.push({
        file,
        reason: inCi ? "in_both" : "in_neither",
      });
    }
  }
  for (const file of machine) {
    if (!verify.has(file)) {
      holes.push({ file, reason: "in_neither" });
    }
  }
  return holes.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Vacuous green when `deployments/` is absent: early-return / skip without
 * asserting once the directory is missing. Such a suite must not be CI-runnable —
 * green-by-absence is worse than missing from CI.
 */
export function isVacuousGreenOnAbsentDeploymentsSource(
  source: string,
): boolean {
  if (!/deployments\b/.test(source)) return false;
  // Nested join(ROOT, "deployments") — scan to `;`, not bare `[^)]*`.
  return /if\s*\(\s*!\s*(?:fs\.)?existsSync\s*\([^;]{0,200}?deployments[^;]{0,80}?\)\s*\)\s*(?:\{\s*)?return\b/.test(
    source,
  );
}

export function ciRunnableVacuousDeploymentsViolation(args: {
  source: string;
  declaredCiRunnable: boolean;
}): string | null {
  if (!args.declaredCiRunnable) return null;
  if (!isVacuousGreenOnAbsentDeploymentsSource(args.source)) return null;
  return "CI-runnable suite passes vacuously when deployments/ is absent";
}
