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
  requireEvmCommercialActive,
  type EvmCommercialActiveStack,
} from "../../lib/web3/commercial-active.js";
import {
  commercialDeploymentPath,
  loadCommercialDeployment,
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

/** Every live EVM commercial chain — registry ≡ local gitignored manifest. */
export function assertAllCommercialActiveMatchManifests(): void {
  for (const chainId of Object.keys(COMMERCIAL_ACTIVE).map(Number)) {
    const stack = COMMERCIAL_ACTIVE[chainId];
    if (!stack || stack.vm !== "evm") continue;
    assertCommercialActiveMatchesManifest(chainId);
  }
}
