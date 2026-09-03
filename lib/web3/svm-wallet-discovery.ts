/**
 * Lazy Solana Wallet Standard discovery — same registration shape as
 * {@link ensureWalletConnectConnector}: start listening on connect attempt,
 * not at provider mount.
 */

import { getWallets } from "@wallet-standard/app";
import type { Wallet } from "@wallet-standard/base";
import {
  StandardConnect,
  type StandardConnectFeature,
} from "@wallet-standard/features";

export type SvmDiscoveredWallet = {
  name: string;
  icon: string;
  version: string;
  wallet: Wallet;
};

let discoveryStarted = false;
let walletsApi: ReturnType<typeof getWallets> | null = null;

function isSolanaWallet(wallet: Wallet): boolean {
  return wallet.chains.some((chain) => chain.startsWith("solana:"));
}

function hasStandardConnect(
  wallet: Wallet,
): wallet is Wallet & { features: StandardConnectFeature } {
  return StandardConnect in wallet.features;
}

/**
 * Start Wallet Standard app-ready / register listeners once.
 * Call from the connect dialog open path (parallel to WalletConnect ensure).
 */
export function ensureSvmWalletDiscovery(): void {
  if (typeof window === "undefined") return;
  if (discoveryStarted && walletsApi) return;
  walletsApi = getWallets();
  discoveryStarted = true;
}

function requireWalletsApi(): ReturnType<typeof getWallets> {
  ensureSvmWalletDiscovery();
  if (!walletsApi) {
    throw new Error("ensureSvmWalletDiscovery: Wallet Standard API unavailable");
  }
  return walletsApi;
}

/** Solana wallets currently registered (after discovery started). */
export function listDiscoveredSvmWallets(): readonly SvmDiscoveredWallet[] {
  if (typeof window === "undefined") return [];
  const api = requireWalletsApi();
  return api
    .get()
    .filter(isSolanaWallet)
    .filter(hasStandardConnect)
    .map((wallet) => ({
      name: wallet.name,
      icon: wallet.icon,
      version: wallet.version,
      wallet,
    }));
}

/** Subscribe to wallet register/unregister; returns unsubscribe. */
export function subscribeSvmWalletDiscovery(
  onChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const api = requireWalletsApi();
  const offRegister = api.on("register", () => onChange());
  const offUnregister = api.on("unregister", () => onChange());
  return () => {
    offRegister();
    offUnregister();
  };
}

export function findDiscoveredSvmWallet(
  name: string,
): SvmDiscoveredWallet | undefined {
  return listDiscoveredSvmWallets().find((w) => w.name === name);
}
