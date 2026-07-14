import { encodeFunctionData } from "viem";

import { AuctionEscrowAbi, MarketplaceEscrowAbi } from "../../lib/contracts/abis.generated.js";
import { CONTRACT_VERSIONS } from "./contract-versions.js";
import {
  SEPOLIA_FALLBACK,
  type DeploymentManifest,
} from "./load-deployment.js";

/** Canonical Base Sepolia WETH — AuctionEscrow wrappedNative immutable. */
export const BASE_SEPOLIA_WETH =
  "0x4200000000000000000000000000000000000006" as const;

/** Platform fee — 0.1% (10 bps). Matches marketplace deploy + auction-design §9. */
export const AUCTION_PLATFORM_FEE_BPS = 10n;

/** Must match `scripts/deploy.ts`. */
export const MARKETPLACE_FEE_BPS = 10n;
export const MARKETPLACE_PRO_FEE_BPS = 0n;
export const MARKETPLACE_MAX_FEED_STALENESS = 3600n;
export const DISPUTE_DEPOSIT = 10_000_000_000_000_000n;

export function karPassportConstructorArgs(manifest: DeploymentManifest) {
  const deployer = manifest.deployer ?? SEPOLIA_FALLBACK.deployer;
  return [manifest.karProStaking, deployer, DISPUTE_DEPOSIT] as const;
}

export function karProStakingConstructorArgs(manifest: DeploymentManifest) {
  const deployer = manifest.deployer ?? SEPOLIA_FALLBACK.deployer;
  return [manifest.karProPass, deployer] as const;
}

export function timelockConstructorArgs(manifest: DeploymentManifest) {
  const deployer = manifest.deployer ?? SEPOLIA_FALLBACK.deployer;
  return [[deployer], [deployer], deployer] as const;
}

export function marketplaceImplConstructorArgs(manifest: DeploymentManifest) {
  const usdc = manifest.usdc ?? SEPOLIA_FALLBACK.usdc;
  const nativeFeed = manifest.nativeFeed ?? SEPOLIA_FALLBACK.nativeFeed;
  const platformRecipient =
    manifest.platformRecipient ?? SEPOLIA_FALLBACK.platformRecipient;

  return [
    manifest.karPassport,
    usdc,
    nativeFeed,
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

export function proxyOnftAdapterConstructorArgs(manifest: DeploymentManifest) {
  const deployer = manifest.deployer ?? SEPOLIA_FALLBACK.deployer;
  const lzEndpoint =
    manifest.layerZeroEndpoint ??
    ("0x6EDCE65403992e310A62460808c4b910D972f10f" as const);
  return [
    manifest.karPassport,
    manifest.marketplace,
    lzEndpoint,
    deployer,
  ] as const;
}

export function auctionEscrowImplConstructorArgs(manifest: DeploymentManifest) {
  const usdc = manifest.usdc ?? SEPOLIA_FALLBACK.usdc;
  const platformRecipient =
    manifest.platformRecipient ?? SEPOLIA_FALLBACK.platformRecipient;

  return [
    manifest.karPassport,
    usdc,
    BASE_SEPOLIA_WETH,
    manifest.karProStaking,
    platformRecipient,
    AUCTION_PLATFORM_FEE_BPS,
  ] as const;
}

export function auctionEscrowProxyConstructorArgs(manifest: DeploymentManifest) {
  const timelock = manifest.timelock ?? SEPOLIA_FALLBACK.timelock;
  if (!manifest.auctionEscrowImpl) {
    throw new Error("Manifest missing auctionEscrowImpl for proxy verify args");
  }
  const initData = encodeFunctionData({
    abi: AuctionEscrowAbi,
    functionName: "initialize",
    args: [timelock],
  });

  return [manifest.auctionEscrowImpl, initData] as const;
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
    label: "KarPassport (1.2.0-rc.1)",
    contract: "contracts/KarPassport.sol:KarPassport",
    addressKey: "karPassport" as const,
    buildArgs: karPassportConstructorArgs,
  },
  marketplaceImpl: {
    label: "MarketplaceEscrow impl (2.0.0-rc.1)",
    contract: "contracts/MarketplaceEscrow.sol:MarketplaceEscrow",
    addressKey: "marketplaceImpl" as const,
    buildArgs: marketplaceImplConstructorArgs,
  },
  marketplaceProxy: {
    label: "MarketplaceEscrow proxy (2.0.0-rc.1)",
    contract:
      "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy",
    addressKey: "marketplace" as const,
    buildArgs: marketplaceProxyConstructorArgs,
  },
  proxyOnftAdapter: {
    label: "ProxyONFT721Adapter (1.0.0-rc.1)",
    contract: "contracts/ProxyONFT721Adapter.sol:ProxyONFT721Adapter",
    addressKey: "proxyOnftAdapter" as const,
    buildArgs: proxyOnftAdapterConstructorArgs,
  },
  auctionEscrowImpl: {
    label: `AuctionEscrow impl (${CONTRACT_VERSIONS.AuctionEscrow})`,
    contract: "contracts/AuctionEscrow.sol:AuctionEscrow",
    addressKey: "auctionEscrowImpl" as const,
    buildArgs: auctionEscrowImplConstructorArgs,
  },
  auctionEscrowProxy: {
    label: `AuctionEscrow proxy (${CONTRACT_VERSIONS.AuctionEscrow})`,
    contract:
      "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy",
    addressKey: "auctionEscrow" as const,
    buildArgs: auctionEscrowProxyConstructorArgs,
  },
} as const;

export type VerifyTargetKey = keyof typeof VERIFY_TARGETS;
