import { encodeFunctionData, getAddress } from "viem";

import {
  AscendingConsignmentAbi,
  FixedPriceConsignmentAbi,
} from "../../lib/contracts/abis.generated.js";
import { lzEndpointForChain, getChainFeedConfig } from "./chainlink-feeds.js";
import { CONTRACT_VERSIONS } from "./contract-versions.js";
import {
  SEPOLIA_FALLBACK,
  type DeploymentManifest,
} from "./load-deployment.js";

/** Platform fee — 0.1% (10 bps). Matches AscendingConsignment deploy + commerce-model §11 / SPEC. */
export const AUCTION_PLATFORM_FEE_BPS = 10n;

/** Must match `scripts/deploy.ts` nuclear constants (FixedPriceConsignment platform fee). */
export const MARKETPLACE_FEE_BPS = 10n;
/** Re-export FixedPrice governance bounds for deploy/tests. */
export {
  MIN_FEED_STALENESS,
  MAX_FEED_STALENESS,
} from "./chainlink-feeds.js";
export const DISPUTE_DEPOSIT = 10_000_000_000_000_000n;

/** Ascending nuclear defaults (governance-mutable after deploy; model §11 / §7.3). */
export const ASCENDING_CHALLENGE_BOND = DISPUTE_DEPOSIT;
export const ASCENDING_CHALLENGE_WINDOW = 14n * 24n * 60n * 60n;
export const ASCENDING_MIN_DURATION = 3n * 24n * 60n * 60n;
export const ASCENDING_MAX_DURATION = 30n * 24n * 60n * 60n;
export const ASCENDING_EXTENSION_WINDOW = 15n * 60n;
export const ASCENDING_MIN_INCREMENT_BPS = 300n;
/** Inclusive opener bounds for per-lot protection (not a protocol-wide hold length). */
export const ASCENDING_MIN_PROTECTION_WINDOW = 7n * 24n * 60n * 60n;
export const ASCENDING_MAX_PROTECTION_WINDOW = 45n * 24n * 60n * 60n;
export const ASCENDING_ABANDONMENT_WINDOW = 30n * 24n * 60n * 60n;

/** Fail-closed: nuclear live deploy requires `COMMERCE_GUARDIAN` (G3 pause role). */
export function resolveCommerceGuardian(
  env: NodeJS.ProcessEnv = process.env,
): `0x${string}` {
  const raw = env.COMMERCE_GUARDIAN?.trim();
  if (!raw) {
    throw new Error("COMMERCE_GUARDIAN is required (G3 pause guardian; no default)");
  }
  return getAddress(raw);
}

export function karPassportConstructorArgs(manifest: DeploymentManifest) {
  const deployer = manifest.deployer ?? SEPOLIA_FALLBACK.deployer;
  const platformRecipient =
    manifest.platformRecipient ?? SEPOLIA_FALLBACK.platformRecipient;
  return [manifest.karProStaking, deployer, DISPUTE_DEPOSIT, platformRecipient] as const;
}

export function karProStakingConstructorArgs(manifest: DeploymentManifest) {
  const deployer = manifest.deployer ?? SEPOLIA_FALLBACK.deployer;
  return [manifest.karProPass, deployer] as const;
}

export function timelockConstructorArgs(manifest: DeploymentManifest) {
  const deployer = manifest.deployer ?? SEPOLIA_FALLBACK.deployer;
  return [[deployer], [deployer], deployer] as const;
}

export function karPassportBridgeGatewayConstructorArgs(
  manifest: DeploymentManifest,
) {
  const deployer = manifest.deployer ?? SEPOLIA_FALLBACK.deployer;
  const lzEndpoint =
    manifest.layerZeroEndpoint ?? lzEndpointForChain(manifest.chainId);
  return [manifest.karPassport, lzEndpoint, deployer] as const;
}

/** FixedPrice impl has empty constructor (`_disableInitializers` only). */
export function fixedPriceConsignmentImplConstructorArgs(_manifest: DeploymentManifest) {
  return [] as const;
}

export function fixedPriceConsignmentProxyConstructorArgs(manifest: DeploymentManifest) {
  const timelock = manifest.timelock ?? SEPOLIA_FALLBACK.timelock;
  const guardian = manifest.commerceGuardian;
  if (!manifest.fixedPriceConsignmentImpl) {
    throw new Error("Manifest missing fixedPriceConsignmentImpl for proxy verify args");
  }
  if (!guardian) {
    throw new Error("Manifest missing commerceGuardian for FixedPrice proxy verify args");
  }
  const nativeFeed = manifest.nativeFeed ?? SEPOLIA_FALLBACK.nativeFeed;
  const platformRecipient =
    manifest.platformRecipient ?? SEPOLIA_FALLBACK.platformRecipient;
  const feeds = getChainFeedConfig(manifest.chainId);
  const initData = encodeFunctionData({
    abi: FixedPriceConsignmentAbi,
    functionName: "initialize",
    args: [
      manifest.karPassport,
      platformRecipient,
      MARKETPLACE_FEE_BPS,
      nativeFeed,
      feeds.nativeUsdStalenessTolerance,
      timelock,
      guardian,
    ],
  });
  return [manifest.fixedPriceConsignmentImpl, initData] as const;
}

export function ascendingConsignmentImplConstructorArgs(_manifest: DeploymentManifest) {
  return [] as const;
}

export function ascendingConsignmentProxyConstructorArgs(manifest: DeploymentManifest) {
  const timelock = manifest.timelock ?? SEPOLIA_FALLBACK.timelock;
  const guardian = manifest.commerceGuardian;
  if (!manifest.ascendingConsignmentImpl) {
    throw new Error("Manifest missing ascendingConsignmentImpl for proxy verify args");
  }
  if (!guardian) {
    throw new Error("Manifest missing commerceGuardian for Ascending proxy verify args");
  }
  const platformRecipient =
    manifest.platformRecipient ?? SEPOLIA_FALLBACK.platformRecipient;
  const initData = encodeFunctionData({
    abi: AscendingConsignmentAbi,
    functionName: "initialize",
    args: [
      manifest.karPassport,
      manifest.karProStaking,
      platformRecipient,
      AUCTION_PLATFORM_FEE_BPS,
      platformRecipient,
      ASCENDING_CHALLENGE_BOND,
      ASCENDING_CHALLENGE_WINDOW,
      ASCENDING_MIN_DURATION,
      ASCENDING_MAX_DURATION,
      ASCENDING_EXTENSION_WINDOW,
      ASCENDING_MIN_INCREMENT_BPS,
      ASCENDING_MIN_PROTECTION_WINDOW,
      ASCENDING_MAX_PROTECTION_WINDOW,
      ASCENDING_ABANDONMENT_WINDOW,
      timelock,
      guardian,
    ],
  });
  return [manifest.ascendingConsignmentImpl, initData] as const;
}

export const VERIFY_TARGETS = {
  timelock: {
    label: "Timelock48h (1.0.0-rc.1)",
    contract: "contracts/Timelock48h.sol:Timelock48h",
    addressKey: "timelock" as const,
    buildArgs: timelockConstructorArgs,
  },
  karProStaking: {
    label: "KarProStaking (1.1.0-rc.1)",
    contract: "contracts/KarProStaking.sol:KarProStaking",
    addressKey: "karProStaking" as const,
    buildArgs: karProStakingConstructorArgs,
  },
  karPassport: {
    label: `KarPassport (${CONTRACT_VERSIONS.KarPassport})`,
    contract: "contracts/KarPassport.sol:KarPassport",
    addressKey: "karPassport" as const,
    buildArgs: karPassportConstructorArgs,
  },
  bridgeGateway: {
    label: `KarPassportBridgeGateway (${CONTRACT_VERSIONS.KarPassportBridgeGateway})`,
    contract: "contracts/KarPassportBridgeGateway.sol:KarPassportBridgeGateway",
    addressKey: "bridgeGateway" as const,
    buildArgs: karPassportBridgeGatewayConstructorArgs,
  },
  fixedPriceConsignmentImpl: {
    label: `FixedPriceConsignment impl (${CONTRACT_VERSIONS.FixedPriceConsignment})`,
    contract: "contracts/FixedPriceConsignment.sol:FixedPriceConsignment",
    addressKey: "fixedPriceConsignmentImpl" as const,
    buildArgs: fixedPriceConsignmentImplConstructorArgs,
  },
  fixedPriceConsignmentProxy: {
    label: `FixedPriceConsignment proxy (${CONTRACT_VERSIONS.FixedPriceConsignment})`,
    contract:
      "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy",
    addressKey: "fixedPriceConsignment" as const,
    buildArgs: fixedPriceConsignmentProxyConstructorArgs,
  },
  ascendingHoldLib: {
    label: "AscendingHoldLib",
    contract: "contracts/lib/AscendingHoldLib.sol:AscendingHoldLib",
    addressKey: "ascendingHoldLib" as const,
    buildArgs: (_manifest: DeploymentManifest) => [] as const,
  },
  ascendingOpenLib: {
    label: "AscendingOpenLib",
    contract: "contracts/lib/AscendingOpenLib.sol:AscendingOpenLib",
    addressKey: "ascendingOpenLib" as const,
    buildArgs: (_manifest: DeploymentManifest) => [] as const,
  },
  ascendingConsignmentImpl: {
    label: `AscendingConsignment impl (${CONTRACT_VERSIONS.AscendingConsignment})`,
    contract: "contracts/AscendingConsignment.sol:AscendingConsignment",
    addressKey: "ascendingConsignmentImpl" as const,
    buildArgs: ascendingConsignmentImplConstructorArgs,
  },
  ascendingConsignmentProxy: {
    label: `AscendingConsignment proxy (${CONTRACT_VERSIONS.AscendingConsignment})`,
    contract:
      "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy",
    addressKey: "ascendingConsignment" as const,
    buildArgs: ascendingConsignmentProxyConstructorArgs,
  },
} as const;

export type VerifyTargetKey = keyof typeof VERIFY_TARGETS;

/** Hub Base Sepolia verify targets (spoke gateway verify lands in C2). */
export type HubVerifyTargetKey = VerifyTargetKey;
