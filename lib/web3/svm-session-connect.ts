/**
 * Pure SVM connect account selection — shared by interactive and silent hydrate.
 * Never invents an address from preference storage.
 */

import type { Wallet, WalletAccount } from "@wallet-standard/base";

/**
 * Prefer accounts returned by standard:connect; else the wallet's current accounts.
 */
export function pickSvmConnectAccount(
  accounts: readonly WalletAccount[],
  wallet: Wallet,
): WalletAccount | undefined {
  return accounts[0] ?? wallet.accounts[0];
}
