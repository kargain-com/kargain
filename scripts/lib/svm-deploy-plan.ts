/**
 * Pure SVM commercial deploy plan — Solana Devnet (and local) programs.
 * Mirrors nuclear-deploy-plan discipline: no cluster I/O in the builder;
 * upgrade authority fail-closed like resolveNuclearRoles.
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { namespaceFromLayerZeroEid } from "../../lib/web3/kargain-namespace.js";

/** Solana Devnet LayerZero EID — pathway peer for hub 40245 (SPEC §13.1 / §13.5). */
export const SOLANA_DEVNET_EID = 40168;

export type SvmDeployCluster = "solana-devnet" | "local";

/** Production commercial programs (SPEC). Mocks are stand-only. */
export const SVM_COMMERCIAL_PROGRAMS = [
  {
    name: "kar_passport",
    dir: "kar-passport",
    role: "passport + state PDAs + Core authority",
  },
  {
    name: "kar_gateway",
    dir: "kar-gateway",
    role: "Send / LzReceive / recover / lz_receive_types",
  },
] as const;

export type SvmCommercialProgramName = (typeof SVM_COMMERCIAL_PROGRAMS)[number]["name"];

/** Default rent params (Solana genesis defaults) — offline estimate only. */
const LAMPORTS_PER_BYTE_YEAR = 3480;
const EXEMPTION_THRESHOLD_YEARS = 2;
const ACCOUNT_STORAGE_OVERHEAD = 128;
/** Upgradeable ProgramData account header (loader-v3). */
const PROGRAMDATA_HEADER = 45;
/** Upgradeable Program account data length. */
const PROGRAM_ACCOUNT_DATA_LEN = 36;

/**
 * Offline rent-exempt minimum for an account of `dataLen` bytes.
 * Not a cluster read — S4b re-measures on Devnet before pinning budgets.
 */
export function estimateRentExemptLamports(dataLen: number): number {
  if (!Number.isInteger(dataLen) || dataLen < 0) {
    throw new Error(`estimateRentExemptLamports: invalid dataLen ${dataLen}`);
  }
  return Math.ceil(
    (ACCOUNT_STORAGE_OVERHEAD + dataLen) *
      LAMPORTS_PER_BYTE_YEAR *
      EXEMPTION_THRESHOLD_YEARS,
  );
}

/** Fail-closed: SVM live deploy requires upgrade authority (Squads stand-in). */
export function resolveSvmUpgradeAuthority(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.SVM_UPGRADE_AUTHORITY?.trim();
  if (!raw) {
    throw new Error(
      "SVM_UPGRADE_AUTHORITY is required (Squads / upgrade authority base58; no default)",
    );
  }
  return raw;
}

export type SvmDeployProgramRow = {
  name: SvmCommercialProgramName;
  dir: string;
  role: string;
  /** Artifact path under svm/target/deploy when present. */
  artifactPath: string;
  /** Byte size of .so when on disk; null if missing (dry-run still prints). */
  soBytes: number | null;
  /** Program account rent-exempt estimate. */
  programAccountRentLamports: number;
  /** ProgramData rent-exempt estimate for soBytes + header (0 if size unknown). */
  programDataRentLamports: number | null;
  /** Authority the program ends under after deploy + handoff. */
  finalUpgradeAuthority: string;
};

export type SvmDeployPlan = {
  cluster: SvmDeployCluster;
  eid: number;
  namespace: number;
  /** SBPFv3 — required for upgradeable loader after SIMD-0500. */
  buildArch: "v3";
  upgradeAuthority: string;
  programs: readonly SvmDeployProgramRow[];
};

export type BuildSvmDeployPlanOpts = {
  cluster: SvmDeployCluster;
  upgradeAuthority: string;
  /** Override svm/ root (tests). Default: <repo>/svm */
  svmRoot?: string;
};

function soSize(artifactPath: string): number | null {
  if (!existsSync(artifactPath)) return null;
  return statSync(artifactPath).size;
}

export function buildSvmDeployPlan(opts: BuildSvmDeployPlanOpts): SvmDeployPlan {
  const authority = opts.upgradeAuthority.trim();
  if (!authority) {
    throw new Error(
      "SVM_UPGRADE_AUTHORITY is required (Squads / upgrade authority base58; no default)",
    );
  }

  const svmRoot =
    opts.svmRoot ?? path.resolve(process.cwd(), "svm");
  const deployDir = path.join(svmRoot, "target", "deploy");

  const programs: SvmDeployProgramRow[] = SVM_COMMERCIAL_PROGRAMS.map((p) => {
    const artifactPath = path.join(deployDir, `${p.name}.so`);
    const soBytes = soSize(artifactPath);
    const programDataRentLamports =
      soBytes == null
        ? null
        : estimateRentExemptLamports(PROGRAMDATA_HEADER + soBytes);
    return {
      name: p.name,
      dir: p.dir,
      role: p.role,
      artifactPath,
      soBytes,
      programAccountRentLamports: estimateRentExemptLamports(PROGRAM_ACCOUNT_DATA_LEN),
      programDataRentLamports,
      finalUpgradeAuthority: authority,
    };
  });

  return {
    cluster: opts.cluster,
    eid: SOLANA_DEVNET_EID,
    namespace: namespaceFromLayerZeroEid(SOLANA_DEVNET_EID),
    buildArch: "v3",
    upgradeAuthority: authority,
    programs,
  };
}

export function formatSvmDeployPlanTable(plan: SvmDeployPlan): string {
  const lines: string[] = [
    `SVM deploy plan — cluster=${plan.cluster} eid=${plan.eid} namespace=${plan.namespace}`,
    `buildArch=${plan.buildArch}  finalUpgradeAuthority=${plan.upgradeAuthority}`,
    "",
    "program         soBytes   progRent      dataRent      role",
    "--------------  --------  ------------  ------------  ----",
  ];
  for (const p of plan.programs) {
    const so = p.soBytes == null ? "missing" : String(p.soBytes);
    const data =
      p.programDataRentLamports == null
        ? "n/a"
        : String(p.programDataRentLamports);
    lines.push(
      `${p.name.padEnd(14)}  ${so.padStart(8)}  ${String(p.programAccountRentLamports).padStart(12)}  ${data.padStart(12)}  ${p.role}`,
    );
  }
  lines.push("");
  lines.push(
    "Rent figures are offline genesis-default estimates — S4b re-measures on Devnet before pinning.",
  );
  lines.push("No cluster connection in dry-run. Mocks (endpoint/staking) are stand-only — not listed.");
  return lines.join("\n");
}
