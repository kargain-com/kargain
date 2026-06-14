import { encodeFunctionData } from "viem";

import { MarketplaceEscrowAbi } from "../../lib/contracts/abis.generated.js";
import {
  SEPOLIA_FALLBACK,
  type DeploymentManifest,
} from "./load-deployment.js";

/** Must match `scripts/deploy-v1.1.ts`. */
export const MARKETPLACE_FEE_BPS = 10n;
export const MARKETPLACE_PRO_FEE_BPS = 0n;
export const MARKETPLACE_MAX_FEED_STALENESS = 3600n;

export function karPassportConstructorArgs(manifest: DeploymentManifest) {
  return [manifest.karProStaking] as const;
}

export function marketplaceImplConstructorArgs(manifest: DeploymentManifest) {
  const usdc = manifest.usdc ?? SEPOLIA_FALLBACK.usdc;
  const nativeFeed = manifest.nativeFeed ?? SEPOLIA_FALLBACK.nativeFeed;
  const eurFeed = manifest.eurFeed ?? SEPOLIA_FALLBACK.eurFeed;
  const platformRecipient =
    manifest.platformRecipient ?? SEPOLIA_FALLBACK.platformRecipient;

  return [
    manifest.karPassport,
    usdc,
    nativeFeed,
    eurFeed,
    manifest.karProStaking,
    platformRecipient,
    MARKETPLACE_FEE_BPS,
    MARKETPLACE_PRO_FEE_BPS,
    MARKETPLACE_MAX_FEED_STALENESS,
  ] as const;
}

export function marketplaceProxyConstructorArgs(manifest: DeploymentManifest) {
  const deployer = manifest.deployer ?? SEPOLIA_FALLBACK.deployer;
  const initData = encodeFunctionData({
    abi: MarketplaceEscrowAbi,
    functionName: "initialize",
    args: [deployer],
  });

  return [manifest.marketplaceImpl, initData] as const;
}

export const VERIFY_TARGETS = {
  karPassport: {
    label: "KarPassport v1.1",
    contract: "contracts/KarPassport.sol:KarPassport",
    addressKey: "karPassport" as const,
    buildArgs: karPassportConstructorArgs,
  },
  marketplaceImpl: {
    label: "MarketplaceEscrow impl",
    contract: "contracts/MarketplaceEscrow.sol:MarketplaceEscrow",
    addressKey: "marketplaceImpl" as const,
    buildArgs: marketplaceImplConstructorArgs,
  },
  marketplaceProxy: {
    label: "MarketplaceEscrow proxy",
    contract:
      "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy",
    addressKey: "marketplace" as const,
    buildArgs: marketplaceProxyConstructorArgs,
  },
} as const;

export type VerifyTargetKey = keyof typeof VERIFY_TARGETS;
