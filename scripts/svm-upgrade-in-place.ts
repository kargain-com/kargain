/**
 * Upgrade commercial BPF programs in place — program ids from COMMERCIAL_ACTIVE only.
 * Does not create program keypairs. Writes evidence via svm-devnet-evidence-write owner.
 *
 * Usage:
 *   pnpm exec tsx scripts/svm-upgrade-in-place.ts \
 *     --programs kar_passport,kar_gateway,kar_pro_staking,kar_pro_pass \
 *     --so-dir svm/target/deploy \
 *     --rpc <url> \
 *     --deployer-keypair <path> \
 *     --evidence deployments/svm-40168.json
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  COMMERCIAL_ACTIVE,
  requireSvmCommercialActive,
  type SvmCommercialActiveStack,
} from "../lib/web3/commercial-active.ts";
import { SVM_COMMERCIAL_PROGRAM_CENSUS } from "../lib/svm/ingest-config.ts";
import { namespaceFromLayerZeroEid } from "../lib/web3/kargain-namespace.ts";
import { assertSolanaUpgradeAuthorityMatchesDeployer } from "./lib/svm-deploy-plan.ts";
import { loadSvmDevnetEvidence } from "./lib/load-deployment.ts";
import {
  artifactDigestFromSo,
  mergeAndWriteSvmDevnetEvidence,
  type SvmProgramEvidencePatch,
} from "./lib/svm-devnet-evidence-write.ts";
import { assertProgramShowAllowsUpgrade } from "./lib/svm-upgrade-in-place-assert.ts";

const CALLER = "svm-upgrade-in-place.ts";

const UPGRADABLE_EVIDENCE_KEYS = new Set(
  SVM_COMMERCIAL_PROGRAM_CENSUS.map((r) => r.evidenceKey),
);

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) {
    throw new Error(`missing ${name}`);
  }
  return process.argv[i + 1]!;
}

function optionalArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

function registryProgramId(
  stack: SvmCommercialActiveStack,
  evidenceKey: string,
): string {
  const row = SVM_COMMERCIAL_PROGRAM_CENSUS.find((r) => r.evidenceKey === evidenceKey);
  if (!row) {
    throw new Error(`${CALLER}: unknown evidence key ${evidenceKey}`);
  }
  const id = stack[row.stackField];
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(
      `${CALLER}: COMMERCIAL_ACTIVE missing program id for ${evidenceKey}`,
    );
  }
  return id;
}

function soPathForEvidenceKey(soDir: string, evidenceKey: string): string {
  const p = join(soDir, `${evidenceKey}.so`);
  if (!existsSync(p)) {
    throw new Error(`${CALLER}: missing artifact ${p}`);
  }
  return p;
}

function runSolana(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("solana", args, {
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function main(): void {
  const programsCsv = arg("--programs");
  const soDir = arg("--so-dir");
  const rpc = arg("--rpc");
  const deployerKp = arg("--deployer-keypair");
  const evidencePath =
    optionalArg("--evidence") ?? "deployments/svm-40168.json";
  const eid = Number(optionalArg("--eid") ?? "40168");

  const keys = programsCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (keys.length === 0) {
    throw new Error(`${CALLER}: --programs empty`);
  }
  for (const k of keys) {
    if (!UPGRADABLE_EVIDENCE_KEYS.has(k as never)) {
      throw new Error(
        `${CALLER}: ${k} is not a commercial evidence key — refuse (no new program ids here)`,
      );
    }
  }

  void COMMERCIAL_ACTIVE;
  const namespace = namespaceFromLayerZeroEid(eid);
  const stack = requireSvmCommercialActive(namespace);

  const showDeployer = runSolana(["address", "-k", deployerKp]);
  if (showDeployer.status !== 0) {
    throw new Error(`${CALLER}: cannot read deployer address from keypair path`);
  }
  const deployerPub = showDeployer.stdout.trim();
  assertSolanaUpgradeAuthorityMatchesDeployer(deployerPub);

  const patches: Record<string, SvmProgramEvidencePatch> = {};

  for (const evidenceKey of keys) {
    const programId = registryProgramId(stack, evidenceKey);
    const show = runSolana(["program", "show", programId, "-u", rpc]);
    if (show.status !== 0) {
      throw new Error(
        `${CALLER}: ${evidenceKey} programId from registry is absent on-chain ` +
          `(program show exit ${show.status})`,
      );
    }
    assertProgramShowAllowsUpgrade({
      showText: `${show.stdout}\n${show.stderr}`,
      programId,
      deployerPubkey: deployerPub,
      evidenceKey,
      caller: CALLER,
    });

    const soPath = soPathForEvidenceKey(soDir, evidenceKey);
    const digest = artifactDigestFromSo(soPath);

    console.log(
      `==> upgrade ${evidenceKey} → ${programId.slice(0, 4)}…${programId.slice(-4)}`,
    );
    // --program-id accepts a base58 address for upgrades (solana program deploy --help).
    const deploy = runSolana([
      "program",
      "deploy",
      soPath,
      "--program-id",
      programId,
      "--upgrade-authority",
      deployerKp,
      "--keypair",
      deployerKp,
      "-u",
      rpc,
    ]);
    if (deploy.status !== 0) {
      console.error(deploy.stdout);
      console.error(deploy.stderr);
      throw new Error(`${CALLER}: solana program deploy failed for ${evidenceKey}`);
    }

    patches[evidenceKey] = {
      programId,
      soSha256: digest.soSha256,
      soBytes: digest.soBytes,
      upgradeAuthority: deployerPub,
    };
  }

  const prior = loadSvmDevnetEvidence(eid);
  mergeAndWriteSvmDevnetEvidence(evidencePath, {
    caller: CALLER,
    prior,
    programs: patches,
  });
  console.log(`==> evidence updated ${evidencePath}`);
}

function isExecutedAsCli(): boolean {
  const entry = process.argv[1];
  if (entry == null) return false;
  return /svm-upgrade-in-place\.(ts|js|mjs|cjs)$/.test(entry);
}

if (isExecutedAsCli()) {
  main();
}
