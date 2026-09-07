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
 *     --evidence deployments/svm-40168.json \
 *     [--dry-run]
 *
 * --dry-run: show + UA + capacity + digests + retention + payer cost; no deploy, no evidence write.
 * Live upgrades pass --no-auto-extend (capacity must already fit; extend is founder-approved).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  requireSvmCommercialActive,
  type SvmCommercialActiveStack,
} from "../lib/web3/commercial-active.js";
import {
  resolveIngestStartSlot,
  SVM_COMMERCIAL_PROGRAM_CENSUS,
} from "../lib/svm/ingest-config.js";
import {
  evaluateStartupRetention,
  startupRetentionUnavailableMessage,
} from "../lib/svm/startup-retention.js";
import { namespaceFromLayerZeroEid } from "../lib/web3/kargain-namespace.js";
import { assertSolanaUpgradeAuthorityMatchesDeployer } from "./lib/svm-deploy-plan.js";
import { loadSvmDevnetEvidence } from "./lib/load-deployment.js";
import {
  artifactDigestFromSo,
  currentSourceGitHead,
  mergeAndWriteSvmDevnetEvidence,
  type SvmProgramEvidencePatch,
} from "./lib/svm-devnet-evidence-write.js";
import {
  assertArtifactFitsProgramCapacity,
  assertPayerCoversUpgradeCost,
  assertProgramShowAllowsUpgrade,
  evaluateArtifactCapacityFit,
  parseProgramDataCapacityBytes,
} from "./lib/svm-upgrade-in-place-assert.js";
import {
  formatUpgradePlannedChangeTable,
  formatUpgradeProgramStatusTable,
  isAbsentProgramShowFailure,
  isTransportCliFailure,
  maskBase58Id,
  parseBalanceLamports,
  parseProgramShowAuthority,
  parseRentExemptLamports,
  sanitizeCliDetail,
  type UpgradePlannedChangeRow,
  type UpgradeProgramStatusRow,
} from "./lib/svm-upgrade-in-place-preflight.js";

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

async function rpcJsonResult(rpcUrl: string, method: string): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
  });
  if (!res.ok) {
    throw new Error(`${CALLER}: RPC ${method} HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    result?: unknown;
    error?: { message?: string };
  };
  if (body.error) {
    throw new Error(
      `${CALLER}: RPC ${method} error: ${body.error.message ?? "unknown"}`,
    );
  }
  return body.result;
}

async function assertConfiguredRpcRetention(
  rpcUrl: string,
  stack: SvmCommercialActiveStack,
): Promise<{
  requiredSlot: number;
  firstAvailableBlock: number;
  headSlot: number;
}> {
  const requiredSlot = resolveIngestStartSlot(stack);
  const firstAvailableBlock = Number(
    await rpcJsonResult(rpcUrl, "getFirstAvailableBlock"),
  );
  const headSlot = Number(await rpcJsonResult(rpcUrl, "getSlot"));
  if (!Number.isInteger(firstAvailableBlock) || !Number.isInteger(headSlot)) {
    throw new Error(`${CALLER}: RPC retention read returned non-integer slots`);
  }
  const result = evaluateStartupRetention({
    requiredSlot,
    firstAvailableBlock,
    headSlot,
  });
  if (!result.ok) {
    throw new Error(startupRetentionUnavailableMessage(result.detail));
  }
  return { requiredSlot, firstAvailableBlock, headSlot };
}

function sleepMs(ms: number): void {
  spawnSync("sleep", [String(ms / 1000)], { encoding: "utf8" });
}

function programShow(args: {
  programId: string;
  rpc: string;
  deployerKp: string;
  evidenceKey: string;
  attempts?: number;
}): { stdout: string; stderr: string } {
  const attempts = args.attempts ?? 4;
  let lastDetail = "";
  for (let i = 0; i < attempts; i++) {
    const show = runSolana([
      "program",
      "show",
      args.programId,
      "-u",
      args.rpc,
      "--keypair",
      args.deployerKp,
    ]);
    if (show.status === 0) {
      return { stdout: show.stdout, stderr: show.stderr };
    }
    lastDetail = sanitizeCliDetail(`${show.stdout}\n${show.stderr}`);
    if (isAbsentProgramShowFailure(lastDetail)) {
      throw new Error(
        `${CALLER}: ${args.evidenceKey} programId from registry is absent on-chain ` +
          `(program show exit ${show.status})`,
      );
    }
    if (i + 1 < attempts && isTransportCliFailure(lastDetail)) {
      sleepMs(1_000 * (i + 1));
      continue;
    }
    throw new Error(
      `${CALLER}: ${args.evidenceKey} program show failed (exit ${show.status}): ` +
        (lastDetail.slice(0, 400) || "no output"),
    );
  }
  throw new Error(
    `${CALLER}: ${args.evidenceKey} program show failed after retries: ` +
      (lastDetail.slice(0, 400) || "no output"),
  );
}

/** Rent-exempt minimum for a temporary upgrade buffer of `dataLength` bytes. */
function rentExemptLamportsForDataLength(dataLength: number, rpc: string): number {
  const r = runSolana([
    "rent",
    String(dataLength),
    "--lamports",
    "-u",
    rpc,
  ]);
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

async function main(): Promise<void> {
  const dryRun = hasFlag("--dry-run");
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

  const namespace = namespaceFromLayerZeroEid(eid);
  const stack = requireSvmCommercialActive(namespace);

  const showDeployer = runSolana(["address", "-k", deployerKp]);
  if (showDeployer.status !== 0) {
    throw new Error(`${CALLER}: cannot read deployer address from keypair path`);
  }
  const deployerPub = showDeployer.stdout.trim();
  assertSolanaUpgradeAuthorityMatchesDeployer(deployerPub);

  const retention = await assertConfiguredRpcRetention(rpc, stack);
  console.log(
    `==> retention ok requiredSlot=${retention.requiredSlot} ` +
      `firstAvailableBlock=${retention.firstAvailableBlock} headSlot=${retention.headSlot}`,
  );

  const sourceGitHead = currentSourceGitHead();
  const prior = loadSvmDevnetEvidence(eid);
  const patches: Record<string, SvmProgramEvidencePatch> = {};
  const planned: UpgradePlannedChangeRow[] = [];
  const capacityFailures: string[] = [];
  const bufferRents: number[] = [];
  const statusRows: UpgradeProgramStatusRow[] = [];

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
    const parsedShow = parseProgramShowAuthority(showText);
    console.log(
      `==> on-chain ${evidenceKey} id=${maskBase58Id(programId)} ` +
        `owner=${parsedShow.ownerLine ?? "absent"} ` +
        `authority=${parsedShow.authority ? maskBase58Id(parsedShow.authority) : "absent"} ` +
        `dataLength=${deployedCapacityBytes}`,
    );

    const soPath = soPathForEvidenceKey(soDir, evidenceKey);
    const digest = artifactDigestFromSo(soPath);
    const fit = evaluateArtifactCapacityFit({
      evidenceKey,
      programId,
      deployedCapacityBytes,
      artifactBytes: digest.soBytes,
      caller: CALLER,
    });
    const priorProg = prior?.programs?.[evidenceKey as keyof typeof prior.programs];
    planned.push({
      evidenceKey,
      maskedProgramId: maskBase58Id(programId),
      priorDigest: priorProg?.soSha256 ?? "absent",
      newDigest: digest.soSha256,
      priorDeploySlot:
        priorProg?.deploySlot != null ? String(priorProg.deploySlot) : "absent",
      soBytes: digest.soBytes,
      deployedCapacityBytes,
      fits: fit.ok ? "yes" : "no",
      deficitBytes: fit.ok ? 0 : fit.deficitBytes,
    });
    if (!fit.ok) {
      capacityFailures.push(fit.message);
    } else {
      bufferRents.push(rentExemptLamportsForDataLength(digest.soBytes, rpc));
    }

    if (dryRun) {
      statusRows.push({
        evidenceKey,
        maskedProgramId: maskBase58Id(programId),
        outcome: "skipped",
        detail: fit.ok ? "dry-run" : "capacity_insufficient",
      });
      continue;
    }

    if (!fit.ok) {
      statusRows.push({
        evidenceKey,
        maskedProgramId: maskBase58Id(programId),
        outcome: "skipped",
        detail: "capacity_insufficient",
      });
      continue;
    }
  }

  const payerLamports = payerBalanceLamports(deployerKp, rpc);
  const estimatedCostLamports = bufferRents.reduce((a, b) => a + b, 0);
  console.log(
    `==> payerLamports=${payerLamports} estimatedCostLamports=${estimatedCostLamports} ` +
      `(sum of solana rent <soBytes> --lamports for programs that fit)`,
  );

  console.log(`==> sourceGitHead=${sourceGitHead}`);
  console.log(formatUpgradePlannedChangeTable(planned));

  if (capacityFailures.length > 0) {
    console.log(formatUpgradeProgramStatusTable(statusRows));
    throw new Error(capacityFailures.join("\n"));
  }
  assertPayerCoversUpgradeCost({
    payerLamports,
    estimatedCostLamports,
    caller: CALLER,
  });

  if (dryRun) {
    console.log(formatUpgradeProgramStatusTable(statusRows));
    console.log(
      "==> DRY-RUN complete — no transactions, no evidence write; deploySlot unchanged",
    );
    return;
  }

  for (const evidenceKey of keys) {
    const programId = registryProgramId(stack, evidenceKey);
    const soPath = soPathForEvidenceKey(soDir, evidenceKey);
    const digest = artifactDigestFromSo(soPath);
    // Capacity already proven in the preflight pass above.
    assertArtifactFitsProgramCapacity({
      evidenceKey,
      programId,
      deployedCapacityBytes: planned.find((r) => r.evidenceKey === evidenceKey)!
        .deployedCapacityBytes,
      artifactBytes: digest.soBytes,
      caller: CALLER,
    });

    console.log(
      `==> upgrade ${evidenceKey} → ${maskBase58Id(programId)} (--no-auto-extend)`,
    );
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
      "--no-auto-extend",
      "-u",
      rpc,
    ]);
    if (deploy.status !== 0) {
      console.error(sanitizeCliDetail(deploy.stdout));
      console.error(sanitizeCliDetail(deploy.stderr));
      statusRows.push({
        evidenceKey,
        maskedProgramId: maskBase58Id(programId),
        outcome: "failed",
        detail: `deploy_exit_${deploy.status}`,
      });
      console.log(formatUpgradeProgramStatusTable(statusRows));
      throw new Error(`${CALLER}: solana program deploy failed for ${evidenceKey}`);
    }

    patches[evidenceKey] = {
      programId,
      soSha256: digest.soSha256,
      soBytes: digest.soBytes,
      sourceGitHead,
      upgradeAuthority: deployerPub,
    };
    statusRows.push({
      evidenceKey,
      maskedProgramId: maskBase58Id(programId),
      outcome: "upgraded",
      detail: "ok",
    });
  }

  console.log(formatUpgradeProgramStatusTable(statusRows));
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
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
