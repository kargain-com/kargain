/**
 * Sole owner: fail-closed equality between COMMERCIAL_ACTIVE and the local
 * gitignored deployments/{chainId}.json for every commercial EVM chain.
 *
 * Missing file → refuse by name (no skip / soft-green).
 * Field mismatch → refuse naming the field.
 */
import { existsSync } from "node:fs";

import { getAddress, type Address } from "viem";

import {
  COMMERCIAL_ACTIVE,
  requireCommercialActive,
  requireEvmCommercialActive,
  type EvmCommercialActiveStack,
  type SvmCommercialActiveStack,
} from "../../lib/web3/commercial-active.js";
import {
  commercialDeploymentPath,
  loadCommercialDeployment,
  loadSvmDevnetEvidence,
  type DeploymentManifest,
} from "./load-deployment.js";

/** Address slots owned by the commercial registry (compared via getAddress). */
const ADDRESS_FIELDS = [
  "karPassport",
  "karProPass",
  "karProStaking",
  "usdc",
  "nativeFeed",
  "timelock",
  "bridgeGateway",
  "fixedPriceConsignment",
  "fixedPriceConsignmentImpl",
  "ascendingConsignment",
  "ascendingConsignmentImpl",
  "layerZeroEndpoint",
  "platformRecipient",
  "forfeitRecipient",
  "deployer",
  "upgradeAuthority",
] as const satisfies ReadonlyArray<keyof EvmCommercialActiveStack>;

type AddressField = (typeof ADDRESS_FIELDS)[number];
const SOLANA_DEVNET_EID = 40168;

const SVM_PROGRAM_FIELDS = [
  ["kar_passport", "karPassport"],
  ["kar_pro_pass", "karProPass"],
  ["kar_pro_staking", "karProStaking"],
  ["kar_fixed_price", "fixedPriceConsignment"],
  ["kar_ascending", "ascendingConsignment"],
  ["kar_gateway", "bridgeGateway"],
] as const;

type SvmProgramField = (typeof SVM_PROGRAM_FIELDS)[number];

function eqAddress(
  a: string | undefined,
  b: string | undefined,
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return getAddress(a as Address) === getAddress(b as Address);
}

/**
 * Compare one EVM commercial stack to a loaded manifest.
 * Throws Error naming the first mismatched field (or absence cause upstream).
 */
export function assertStackMatchesManifest(
  stack: EvmCommercialActiveStack,
  manifest: DeploymentManifest,
): void {
  const chainId = stack.chainId;
  for (const field of ADDRESS_FIELDS) {
    const registryValue = stack[field] as string | undefined;
    const manifestValue = manifest[field as keyof DeploymentManifest] as
      | string
      | undefined;
    if (!eqAddress(registryValue, manifestValue)) {
      throw new Error(
        `COMMERCIAL_ACTIVE[${chainId}] ${field} ≠ deployments/${chainId}.json`,
      );
    }
  }
  if (Number(manifest.indexFromBlock) !== stack.indexFromBlock) {
    throw new Error(
      `COMMERCIAL_ACTIVE[${chainId}] indexFromBlock ≠ deployments/${chainId}.json`,
    );
  }
  for (const [blockKey, registryBlock] of Object.entries(stack.blocks)) {
    if (registryBlock === undefined) continue;
    const manifestBlock =
      manifest.blocks?.[blockKey as keyof DeploymentManifest["blocks"]];
    if (Number(manifestBlock) !== registryBlock) {
      throw new Error(
        `COMMERCIAL_ACTIVE[${chainId}] blocks.${blockKey} ≠ deployments/${chainId}.json`,
      );
    }
  }
}

/**
 * Load local manifest for `chainId` and assert equality with COMMERCIAL_ACTIVE.
 * Missing path or non-commercial shape → refuse naming absence.
 */
export function assertCommercialActiveMatchesManifest(chainId: number): void {
  const path = commercialDeploymentPath(chainId);
  if (!existsSync(path)) {
    throw new Error(
      `COMMERCIAL_ACTIVE[${chainId}] manifest absent at ${path}`,
    );
  }
  const manifest = loadCommercialDeployment(chainId);
  if (!manifest) {
    throw new Error(
      `COMMERCIAL_ACTIVE[${chainId}] manifest unreadable or wrong shape at ${path}`,
    );
  }
  const stack = requireEvmCommercialActive(chainId);
  assertStackMatchesManifest(stack, manifest);
}

function eqLiteral(
  a: string | undefined,
  b: string | undefined,
): boolean {
  return (a ?? "") === (b ?? "");
}

/**
 * Compare the live Solana commercial row to the SVM deploy evidence.
 * The registry row owns product truth; evidence must confirm every field it speaks to.
 */
export function assertCommercialActiveSvmMatchesEvidence(
  eid: number = SOLANA_DEVNET_EID,
): void {
  const evidence = loadSvmDevnetEvidence(eid);
  if (!evidence) {
    throw new Error(
      `COMMERCIAL_ACTIVE[2000040168] evidence absent or unreadable at deployments/svm-${eid}.json`,
    );
  }
  const stack = requireCommercialActive(evidence.namespace ?? 2_000_040_168);
  if (stack.vm !== "svm") {
    throw new Error(
      `COMMERCIAL_ACTIVE[${evidence.namespace ?? 2_000_040_168}] is not an SVM commercial stack`,
    );
  }
  assertSvmStackMatchesEvidence(stack, evidence);
}

export function assertSvmStackMatchesEvidence(
  stack: SvmCommercialActiveStack,
  evidence: NonNullable<ReturnType<typeof loadSvmDevnetEvidence>>,
): void {
  const namespace = Number(stack.namespace);
  if (evidence.namespace !== namespace) {
    throw new Error(
      `COMMERCIAL_ACTIVE[${namespace}] namespace ≠ deployments/svm-${evidence.eid}.json`,
    );
  }
  if (!eqLiteral(stack.layerZeroEndpoint, evidence.layerZeroEndpoint)) {
    throw new Error(
      `COMMERCIAL_ACTIVE[${namespace}] layerZeroEndpoint ≠ deployments/svm-${evidence.eid}.json`,
    );
  }
  if (!eqLiteral(stack.deployer, evidence.deployerPubkey)) {
    throw new Error(
      `COMMERCIAL_ACTIVE[${namespace}] deployer ≠ deployments/svm-${evidence.eid}.json`,
    );
  }
  if (!eqLiteral(stack.upgradeAuthority, evidence.upgradeAuthority)) {
    throw new Error(
      `COMMERCIAL_ACTIVE[${namespace}] upgradeAuthority ≠ deployments/svm-${evidence.eid}.json`,
    );
  }
  if (!eqLiteral(stack.timelock, evidence.deployerPubkey)) {
    throw new Error(
      `COMMERCIAL_ACTIVE[${namespace}] timelock ≠ deployments/svm-${evidence.eid}.json deployerPubkey`,
    );
  }
  if (!eqLiteral(stack.forfeitRecipient, evidence.forfeitRecipient)) {
    throw new Error(
      `COMMERCIAL_ACTIVE[${namespace}] forfeitRecipient ≠ deployments/svm-${evidence.eid}.json`,
    );
  }
  if (!eqLiteral(stack.nativeFeed, "")) {
    throw new Error(
      `COMMERCIAL_ACTIVE[${namespace}] nativeFeed must stay empty until a measured SVM price source ships`,
    );
  }
  for (const [programKey, stackField] of SVM_PROGRAM_FIELDS) {
    const program = evidence.programs[programKey];
    const programId = program?.programId?.trim();
    const stackValue = stack[stackField];
    if (!eqLiteral(stackValue, programId)) {
      throw new Error(
        `COMMERCIAL_ACTIVE[${namespace}] ${stackField} ≠ deployments/svm-${evidence.eid}.json programs.${programKey}.programId`,
      );
    }
    const evidenceSlot = program?.deploySlot;
    const stackSlot = stack.blocks[stackField];
    if (
      typeof evidenceSlot !== "number" ||
      !Number.isInteger(evidenceSlot) ||
      evidenceSlot < 0
    ) {
      throw new Error(
        `COMMERCIAL_ACTIVE[${namespace}] evidence programs.${programKey}.deploySlot missing or invalid`,
      );
    }
    if (stackSlot !== evidenceSlot) {
      throw new Error(
        `COMMERCIAL_ACTIVE[${namespace}] blocks.${stackField} ≠ deployments/svm-${evidence.eid}.json programs.${programKey}.deploySlot`,
      );
    }
  }
}

/** Every live EVM commercial chain — registry ≡ local gitignored manifest. */
export function assertAllCommercialActiveMatchManifests(): void {
  for (const chainId of Object.keys(COMMERCIAL_ACTIVE).map(Number)) {
    const stack = COMMERCIAL_ACTIVE[chainId];
    if (!stack) continue;
    if (stack.vm === "evm") {
      assertCommercialActiveMatchesManifest(chainId);
      continue;
    }
    assertCommercialActiveSvmMatchesEvidence();
  }
}
