/**
 * Branded Wallet Standard cluster identifier for commercial SVM stacks.
 * Mint at registry ingress only — same shape as {@link ExplorerOrigin}.
 */

declare const walletStandardChainBrand: unique symbol;

export type WalletStandardChain = string & {
  readonly [walletStandardChainBrand]: void;
};

/** Clusters that may appear on a commercial SVM stack. */
export const WALLET_STANDARD_CHAINS = [
  "solana:devnet",
  "solana:testnet",
  "solana:mainnet",
] as const;

export type WalletStandardChainValue = (typeof WALLET_STANDARD_CHAINS)[number];

const ALLOWED = new Set<string>(WALLET_STANDARD_CHAINS);

/** Mint a Wallet Standard chain — registry / fixture ingress only. */
export function mintWalletStandardChain(value: string): WalletStandardChain {
  const trimmed = value.trim();
  if (!ALLOWED.has(trimmed)) {
    throw new Error(
      `Invalid WalletStandardChain: ${value} (expected solana:devnet | solana:testnet | solana:mainnet)`,
    );
  }
  return trimmed as WalletStandardChain;
}
