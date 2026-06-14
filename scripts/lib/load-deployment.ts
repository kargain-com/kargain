import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";

import type { LocalStackAddresses } from "./local-stack.js";

export const LOCAL_CHAIN_ID = 31337;

export const DEPLOYMENT_PATH = join(process.cwd(), "deployments/31337.json");

function normalizeDeployment(raw: LocalStackAddresses): LocalStackAddresses {
  return {
    ...raw,
    chainId: raw.chainId ?? LOCAL_CHAIN_ID,
    karPassport: getAddress(raw.karPassport),
    karProPass: getAddress(raw.karProPass),
    karProStaking: getAddress(raw.karProStaking),
    marketplace: getAddress(raw.marketplace),
    marketplaceImpl: getAddress(raw.marketplaceImpl),
    usdc: getAddress(raw.usdc),
    nativeFeed: getAddress(raw.nativeFeed),
    eurFeed: getAddress(raw.eurFeed),
    timelock: getAddress(raw.timelock),
    platformRecipient: getAddress(raw.platformRecipient),
  };
}

export function loadLocalDeployment(): LocalStackAddresses | null {
  if (!existsSync(DEPLOYMENT_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(DEPLOYMENT_PATH, "utf8")) as LocalStackAddresses;
    return normalizeDeployment(raw);
  } catch {
    return null;
  }
}

export function requireLocalDeployment(): LocalStackAddresses {
  const deployment = loadLocalDeployment();
  if (!deployment) {
    throw new Error(
      "Missing deployments/31337.json — start `npx hardhat node` and run `pnpm deploy:local`",
    );
  }
  return deployment;
}

export function ponderLocalAddresses(): LocalStackAddresses {
  const fromEnv = {
    chainId: LOCAL_CHAIN_ID,
    karPassport: process.env.PONDER_KAR_PASSPORT_ADDRESS,
    karProPass: process.env.PONDER_KAR_PRO_PASS_ADDRESS,
    karProStaking: process.env.PONDER_KAR_PRO_STAKING_ADDRESS,
    marketplace: process.env.PONDER_MARKETPLACE_ADDRESS,
    marketplaceImpl: process.env.PONDER_MARKETPLACE_IMPL_ADDRESS,
    usdc: process.env.PONDER_USDC_ADDRESS,
    nativeFeed: process.env.PONDER_NATIVE_FEED_ADDRESS,
    eurFeed: process.env.PONDER_EUR_FEED_ADDRESS ?? "0x0000000000000000000000000000000000000000",
    timelock: process.env.PONDER_TIMELOCK_ADDRESS,
    platformRecipient: process.env.PONDER_PLATFORM_RECIPIENT_ADDRESS,
    deployedAt: "",
  };

  const hasEnv = Boolean(fromEnv.karPassport && fromEnv.marketplace);
  if (hasEnv) {
    return normalizeDeployment(fromEnv as LocalStackAddresses);
  }

  const fromFile = loadLocalDeployment();
  if (fromFile) return fromFile;

  throw new Error(
    "PONDER_ENABLE_LOCAL=1 but no addresses — run `pnpm deploy:local` or set PONDER_*_ADDRESS env vars",
  );
}
