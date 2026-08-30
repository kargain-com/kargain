/**
 * Pure SVM commercial deploy plan — Solana Devnet (and local) programs.
 * Mirrors nuclear-deploy-plan discipline: no cluster I/O in the builder;
 * upgrade authority fail-closed like resolveNuclearRoles.
 *
 * S4–S8: SOLANA_UPGRADE_AUTHORITY must equal the deployer pubkey (EVM-parity
 * simplest testnet). No scheduled handoff to a different env pubkey.
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
  {
    name: "kar_pro_staking",
    dir: "kar-pro-staking",
    role: "native SOL stake + active-verifier answer account",
  },
  {
    name: "kar_pro_pass",
    dir: "kar-pro-pass",
    role: "soulbound Core pass (projection of stake)",
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

/**
 * Fail-closed role resolvers for Solana Devnet deploy.
 * Env names parallel EVM deploy roles — see .env.example "Solana Devnet deploy".
 */

/** Who may replace BPF bytecode (S4–S8 = deployer pubkey). */
export function resolveSolanaUpgradeAuthority(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.SOLANA_UPGRADE_AUTHORITY?.trim();
  if (!raw) {
    throw new Error(
      "SOLANA_UPGRADE_AUTHORITY is required (public base58; must equal deployer pubkey on S4–S8)",
    );
  }
  return raw;
}

/**
 * Refuse when env UA ≠ deployer pubkey (S4–S8 standing rule).
 * `deployerPubkey` is the base58 pubkey of `SOLANA_DEPLOYER_PRIVATE_KEY`.
 */
export function assertSolanaUpgradeAuthorityMatchesDeployer(
  deployerPubkey: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const ua = resolveSolanaUpgradeAuthority(env);
  const deployer = deployerPubkey.trim();
  if (!deployer) {
    throw new Error("deployer pubkey required for SOLANA_UPGRADE_AUTHORITY check");
  }
  if (ua !== deployer) {
    throw new Error(
      `SOLANA_UPGRADE_AUTHORITY (${ua}) ≠ deployer pubkey (${deployer}) — ` +
        `S4–S8 requires UA ≡ deployer (set SOLANA_UPGRADE_AUTHORITY to the deployer pubkey)`,
    );
  }
  return ua;
}

/** Challenge forfeit sink (same role as EVM FORFEIT_RECIPIENT). */
export function resolveSolanaForfeitRecipient(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.SOLANA_FORFEIT_RECIPIENT?.trim();
  if (!raw) {
    throw new Error(
      "SOLANA_FORFEIT_RECIPIENT is required (public base58; no default)",
    );
  }
  return raw;
}

/**
 * Deployer secret — same role as EVM `DEPLOYER_PRIVATE_KEY`.
 * Sole owner: `SOLANA_DEPLOYER_PRIVATE_KEY` (base58 secret key). Never commit.
 */
export function resolveSolanaDeployerPrivateKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.SOLANA_DEPLOYER_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new Error(
      "SOLANA_DEPLOYER_PRIVATE_KEY is required (base58 secret key; same idea as DEPLOYER_PRIVATE_KEY; no default)",
    );
  }
  return raw;
}

/** LayerZero EndpointV2 program id on the target cluster. */
export function resolveSolanaLzEndpoint(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.SOLANA_LZ_ENDPOINT?.trim();
  if (!raw) {
    throw new Error(
      "SOLANA_LZ_ENDPOINT is required (LayerZero EndpointV2 program id; no default)",
    );
  }
  return raw;
}

/**
 * Gateway config authority (setPeer). Empty → null (caller uses deployer pubkey).
 * Same pattern as optional roles that default to deployer on EVM testnet.
 */
export function resolveSolanaGatewayAuthority(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.SOLANA_GATEWAY_AUTHORITY?.trim();
  return raw || null;
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
  /** On-chain UA after deploy (S4–S8 = deployer pubkey, retained). */
  retainedUpgradeAuthority: string;
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
      "SOLANA_UPGRADE_AUTHORITY is required (public base58; must equal deployer pubkey on S4–S8)",
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
      retainedUpgradeAuthority: authority,
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
    `buildArch=${plan.buildArch}  retainedUpgradeAuthority=${plan.upgradeAuthority}`,
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
