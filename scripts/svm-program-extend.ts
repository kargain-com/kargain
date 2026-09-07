/**
 * Founder-approved program-data extend (125 % of new artifact). Separate from
 * upgrade-in-place — never auto-invoked by the upgrade path.
 *
 * Usage:
 *   pnpm exec tsx scripts/svm-program-extend.ts \
 *     --programs kar_passport,kar_gateway,kar_pro_staking,kar_pro_pass \
 *     --so-dir svm/target/deploy \
 *     --rpc <url> \
 *     --deployer-keypair <path> \
 *     [--dry-run]
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  requireSvmCommercialActive,
  type SvmCommercialActiveStack,
} from "../lib/web3/commercial-active.js";
import { SVM_COMMERCIAL_PROGRAM_CENSUS } from "../lib/svm/ingest-config.js";
import { namespaceFromLayerZeroEid } from "../lib/web3/kargain-namespace.js";
import { assertSolanaUpgradeAuthorityMatchesDeployer } from "./lib/svm-deploy-plan.js";
import { artifactDigestFromSo } from "./lib/svm-devnet-evidence-write.js";
import {
  planProgramExtend,
  rentDeltaLamports,
} from "./lib/svm-program-extend-plan.js";
import {
  assertProgramShowAllowsUpgrade,
  assertPayerCoversUpgradeCost,
  parseProgramDataCapacityBytes,
} from "./lib/svm-upgrade-in-place-assert.js";
import {
  formatUpgradeProgramStatusTable,
  maskBase58Id,
  parseBalanceLamports,
  parseRentExemptLamports,
  sanitizeCliDetail,
  type UpgradeProgramStatusRow,
} from "./lib/svm-upgrade-in-place-preflight.js";

const CALLER = "svm-program-extend.ts";

const EXTENDABLE_KEYS = new Set([
  "kar_passport",
  "kar_gateway",
  "kar_pro_staking",
  "kar_pro_pass",
] as const);

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) {
    throw new Error(`missing ${name}`);
  }
  return process.argv[i + 1]!;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
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

function rentExemptLamports(dataLength: number, rpc: string): number {
  const r = runSolana(["rent", String(dataLength), "--lamports", "-u", rpc]);
  if (r.status !== 0) {
    throw new Error(
      `${CALLER}: solana rent failed for dataLength=${dataLength}: ` +
        sanitizeCliDetail(`${r.stdout}\n${r.stderr}`).slice(0, 240),
    );
  }
  return parseRentExemptLamports(`${r.stdout}\n${r.stderr}`);
}

function payerBalanceLamports(deployerKp: string, rpc: string): number {
  const r = runSolana([
    "balance",
    "-k",
    deployerKp,
    "-u",
    rpc,
    "--lamports",
  ]);
  if (r.status !== 0) {
    throw new Error(
      `${CALLER}: solana balance failed: ` +
        sanitizeCliDetail(`${r.stdout}\n${r.stderr}`).slice(0, 240),
    );
  }
  return parseBalanceLamports(`${r.stdout}\n${r.stderr}`);
}

function programShow(args: {
  programId: string;
  rpc: string;
  deployerKp: string;
  evidenceKey: string;
}): { stdout: string; stderr: string } {
  const show = runSolana([
    "program",
    "show",
    args.programId,
    "-k",
    args.deployerKp,
    "-u",
    args.rpc,
  ]);
  if (show.status !== 0) {
    throw new Error(
      `${CALLER}: ${args.evidenceKey} program show failed: ` +
        sanitizeCliDetail(`${show.stdout}\n${show.stderr}`).slice(0, 400),
    );
  }
  return show;
}

type ExtendPlanRow = {
  evidenceKey: string;
  maskedProgramId: string;
  deployedCapacityBytes: number;
  artifactBytes: number;
  targetCapacityBytes: number;
  additionalBytes: number;
  estimatedRentDeltaLamports: number;
  action: "extend" | "skip";
};

function formatExtendPlanTable(rows: readonly ExtendPlanRow[]): string {
  const lines = [
    "program | id | deployed | artifact | target(125%) | additional | rentΔ lamports | action",
    "--------|----|----------|----------|--------------|------------|----------------|--------",
  ];
  for (const row of rows) {
    lines.push(
      [
        row.evidenceKey,
        row.maskedProgramId,
        String(row.deployedCapacityBytes),
        String(row.artifactBytes),
        String(row.targetCapacityBytes),
        String(row.additionalBytes),
        String(row.estimatedRentDeltaLamports),
        row.action,
      ].join(" | "),
    );
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const dryRun = hasFlag("--dry-run");
  const programsCsv = arg("--programs");
  const soDir = arg("--so-dir");
  const rpc = arg("--rpc");
  const deployerKp = arg("--deployer-keypair");
  const eid = 40168;

  const keys = programsCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (keys.length === 0) {
    throw new Error(`${CALLER}: --programs empty`);
  }
  for (const k of keys) {
    if (!EXTENDABLE_KEYS.has(k as never)) {
      throw new Error(
        `${CALLER}: ${k} is not an S9-B extend target (passport/gateway/staking/pass only)`,
      );
    }
  }

  const namespace = namespaceFromLayerZeroEid(eid);
  const stack = requireSvmCommercialActive(namespace);

  const showDeployer = runSolana(["address", "-k", deployerKp]);
  if (showDeployer.status !== 0) {
    throw new Error(`${CALLER}: cannot read deployer address from keypair path`);
  }
  const deployerPub = showDeployer.stdout.trim();
  assertSolanaUpgradeAuthorityMatchesDeployer(deployerPub);

  const planRows: ExtendPlanRow[] = [];
  const statusRows: UpgradeProgramStatusRow[] = [];
  let estimatedCostLamports = 0;

  for (const evidenceKey of keys) {
    const programId = registryProgramId(stack, evidenceKey);
    const show = programShow({
      programId,
      rpc,
      deployerKp,
      evidenceKey,
    });
    const showText = `${show.stdout}\n${show.stderr}`;
    assertProgramShowAllowsUpgrade({
      showText,
      programId,
      deployerPubkey: deployerPub,
      evidenceKey,
      caller: CALLER,
    });
    const deployedCapacityBytes = parseProgramDataCapacityBytes(showText);
    const digest = artifactDigestFromSo(soPathForEvidenceKey(soDir, evidenceKey));
    const plan = planProgramExtend({
      deployedCapacityBytes,
      artifactBytes: digest.soBytes,
    });

    let estimatedRentDeltaLamports = 0;
    if (!plan.skip) {
      const fromRent = rentExemptLamports(plan.deployedCapacityBytes, rpc);
      const toRent = rentExemptLamports(plan.targetCapacityBytes, rpc);
      estimatedRentDeltaLamports = rentDeltaLamports({
        rentExemptFromLamports: fromRent,
        rentExemptToLamports: toRent,
      });
      estimatedCostLamports += estimatedRentDeltaLamports;
    }

    planRows.push({
      evidenceKey,
      maskedProgramId: maskBase58Id(programId),
      deployedCapacityBytes: plan.deployedCapacityBytes,
      artifactBytes: plan.artifactBytes,
      targetCapacityBytes: plan.targetCapacityBytes,
      additionalBytes: plan.additionalBytes,
      estimatedRentDeltaLamports,
      action: plan.skip ? "skip" : "extend",
    });
  }

  const payerLamports = payerBalanceLamports(deployerKp, rpc);
  console.log(
    `==> payerLamports=${payerLamports} estimatedExtendCostLamports=${estimatedCostLamports} ` +
      `(sum of solana rent(target) − rent(deployed) for planned extends)`,
  );
  console.log(formatExtendPlanTable(planRows));

  assertPayerCoversUpgradeCost({
    payerLamports,
    estimatedCostLamports,
    caller: CALLER,
  });

  if (dryRun) {
    for (const row of planRows) {
      statusRows.push({
        evidenceKey: row.evidenceKey,
        maskedProgramId: row.maskedProgramId,
        outcome: "skipped",
        detail: row.action === "skip" ? "already_at_target" : "dry-run",
      });
    }
    console.log(formatUpgradeProgramStatusTable(statusRows));
    console.log("==> DRY-RUN complete — no extend transactions");
    return;
  }

  for (const row of planRows) {
    const programId = registryProgramId(stack, row.evidenceKey);
    if (row.action === "skip") {
      statusRows.push({
        evidenceKey: row.evidenceKey,
        maskedProgramId: row.maskedProgramId,
        outcome: "skipped",
        detail: "already_at_target",
      });
      continue;
    }

    console.log(
      `==> extend ${row.evidenceKey} ${maskBase58Id(programId)} +${row.additionalBytes} ` +
        `(${row.deployedCapacityBytes} → ${row.targetCapacityBytes})`,
    );
    const ext = runSolana([
      "program",
      "extend",
      programId,
      String(row.additionalBytes),
      "-k",
      deployerKp,
      "--payer",
      deployerKp,
      "-u",
      rpc,
    ]);
    if (ext.status !== 0) {
      console.error(sanitizeCliDetail(ext.stdout));
      console.error(sanitizeCliDetail(ext.stderr));
      statusRows.push({
        evidenceKey: row.evidenceKey,
        maskedProgramId: row.maskedProgramId,
        outcome: "failed",
        detail: `extend_exit_${ext.status}`,
      });
      console.log(formatUpgradeProgramStatusTable(statusRows));
      throw new Error(`${CALLER}: solana program extend failed for ${row.evidenceKey}`);
    }

    const verify = programShow({
      programId,
      rpc,
      deployerKp,
      evidenceKey: row.evidenceKey,
    });
    const after = parseProgramDataCapacityBytes(
      `${verify.stdout}\n${verify.stderr}`,
    );
    if (after < row.targetCapacityBytes) {
      statusRows.push({
        evidenceKey: row.evidenceKey,
        maskedProgramId: row.maskedProgramId,
        outcome: "failed",
        detail: `post_extend_capacity_${after}_lt_${row.targetCapacityBytes}`,
      });
      console.log(formatUpgradeProgramStatusTable(statusRows));
      throw new Error(
        `${CALLER}: ${row.evidenceKey} post-extend Data Length ${after} < target ${row.targetCapacityBytes}`,
      );
    }

    statusRows.push({
      evidenceKey: row.evidenceKey,
      maskedProgramId: row.maskedProgramId,
      outcome: "upgraded",
      detail: `capacity=${after}`,
    });
  }

  console.log(formatUpgradeProgramStatusTable(statusRows));
  console.log("==> extend complete — re-run upgrade-in-place --dry-run before Phase 2");
}

function isExecutedAsCli(): boolean {
  const entry = process.argv[1];
  if (entry == null) return false;
  return /svm-program-extend\.(ts|js|mjs|cjs)$/.test(entry);
}

if (isExecutedAsCli()) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
