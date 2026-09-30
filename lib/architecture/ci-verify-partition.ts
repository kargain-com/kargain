/**
 * Sole owner: trunk CI reachability vs deploy-machine vs toolchain exclusions.
 *
 * - `test:ci` = test:verify ∖ DEPLOY_MACHINE_VERIFY_SUITES (never a second file list).
 * - CI_GATE_SCRIPTS = package.json scripts trunk CI runs (YAML names these scripts).
 * - TOOLCHAIN_GATES = gates needing cargo/BPF, solana-test-validator, or Docker/Postgres.
 *
 * Every suite under test/ (*.test.ts) must be reachable from a CI gate script
 * (incl. Hardhat via bare `test`), a TOOLCHAIN gate, or the deploy-machine enumerator.
 */

import { HARDHAT_NATIVE_SUITES } from "./hardhat-test-suites";

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

/**
 * Ordered trunk-CI test steps after lint (before build). YAML must invoke each
 * via `pnpm <script>` — never a parallel hand-maintained file list.
 */
export const CI_GATE_SCRIPTS = [
  "test:ci",
  "test:unit",
  "test",
  "test:commerce-ui",
  "test:passport-ui",
  "test:bridge",
  "test:listing",
  "test:metadata",
  "test:messaging",
  "test:nostr",
  "test:notifications",
  "test:trust",
  "test:records",
  "test:geo",
  "test:vincent-commons",
  "test:verifier",
  "test:confirm-status",
  "test:vin-insight",
  "test:vin-assist",
  "test:vincent",
  "test:ponder",
] as const;

export type CiGateScript = (typeof CI_GATE_SCRIPTS)[number];

/**
 * Gates that need external tooling — mandatory on the deploy machine, not trunk CI.
 * One reason per gate.
 */
export const TOOLCHAIN_GATES = {
  "test:svm": "cargo + BPF toolchain",
  "test:svm-stand": "solana-test-validator",
  "test:svm-ingest":
    "Docker Postgres for PG sentinels (gate not split this unit)",
  "test:e2e": "Hardhat node + Docker Postgres + Ponder (strict e2e)",
} as const;

export type ToolchainGateScript = keyof typeof TOOLCHAIN_GATES;

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
  return /if\s*\(\s*!\s*(?:fs\.)?existsSync\s*\([^;]{0,200}?deployments[^;]{0,80}?\)\s*(?:\{\s*)?return\b/.test(
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

/** Files covered by a CI gate script (Hardhat `test` → HARDHAT_NATIVE_SUITES). */
export function filesForCiGateScript(
  scriptName: string,
  scripts: Record<string, string>,
): string[] {
  if (scriptName === "test") {
    return [...HARDHAT_NATIVE_SUITES];
  }
  if (scriptName === "test:ci") {
    return ciVerifyMembers(scripts);
  }
  const body = scripts[scriptName];
  if (body == null) {
    throw new Error(`package.json scripts missing ${scriptName}`);
  }
  return parseTestFilesFromScriptBody(body);
}

/** Files covered by a TOOLCHAIN gate (cargo `test:svm` contributes none). */
export function filesForToolchainGate(
  scriptName: ToolchainGateScript,
  scripts: Record<string, string>,
): string[] {
  const body = scripts[scriptName];
  if (body == null) return [];
  return parseTestFilesFromScriptBody(body);
}

export function ciReachableTestFiles(
  scripts: Record<string, string>,
): Set<string> {
  const out = new Set<string>();
  for (const gate of CI_GATE_SCRIPTS) {
    for (const f of filesForCiGateScript(gate, scripts)) out.add(f);
  }
  return out;
}

export function toolchainReachableTestFiles(
  scripts: Record<string, string>,
): Set<string> {
  const out = new Set<string>();
  for (const gate of Object.keys(TOOLCHAIN_GATES) as ToolchainGateScript[]) {
    for (const f of filesForToolchainGate(gate, scripts)) out.add(f);
  }
  return out;
}

export type CiReachabilityHole = {
  file: string;
  reason: "unreachable";
};

/**
 * Every suite file must be in CI ∪ TOOLCHAIN ∪ deploy-machine.
 * Intentional Hardhat∩verify dual-home is fine (both are CI-reachable).
 */
export function findCiReachabilityHoles(args: {
  allTestFiles: readonly string[];
  scripts: Record<string, string>;
}): CiReachabilityHole[] {
  const ci = ciReachableTestFiles(args.scripts);
  const toolchain = toolchainReachableTestFiles(args.scripts);
  const machine = new Set<string>(DEPLOY_MACHINE_VERIFY_SUITES);
  const holes: CiReachabilityHole[] = [];
  for (const file of args.allTestFiles) {
    if (ci.has(file) || toolchain.has(file) || machine.has(file)) continue;
    holes.push({ file, reason: "unreachable" });
  }
  return holes.sort((a, b) => a.file.localeCompare(b.file));
}

/** ci.yml must invoke each CI_GATE_SCRIPTS member via a dedicated `run: pnpm <name>`. */
export function missingCiYamlGateSteps(yaml: string): string[] {
  const missing: string[] = [];
  for (const gate of CI_GATE_SCRIPTS) {
    // Bare `test` must not match `test:ci` / `test:unit` — require end of line.
    const re =
      gate === "test"
        ? /^\s*run:\s*pnpm\s+test\s*$/m
        : new RegExp(`^\\s*run:\\s*pnpm\\s+${gate.replace(":", "\\:")}\\s*$`, "m");
    if (!re.test(yaml)) missing.push(gate);
  }
  return missing;
}
