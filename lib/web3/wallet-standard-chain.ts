/**
 * Branded Wallet Standard cluster identifier for commercial SVM stacks.
 * Mint at registry ingress only — brand over the admitted cluster union.
 */

declare const walletStandardChainBrand: unique symbol;

/** Clusters that may appear on a commercial SVM stack. */
export const WALLET_STANDARD_CHAINS = [
  "solana:devnet",
  "solana:mainnet",
] as const;

export type WalletStandardChainValue = (typeof WALLET_STANDARD_CHAINS)[number];

export type WalletStandardChain = WalletStandardChainValue & {
  readonly [walletStandardChainBrand]: void;
};

const ALLOWED = new Set<string>(WALLET_STANDARD_CHAINS);

/** Mint a Wallet Standard chain — registry / fixture ingress only. */
export function mintWalletStandardChain(value: string): WalletStandardChain {
  const trimmed = value.trim();
  if (!ALLOWED.has(trimmed)) {
    throw new Error(
      `Invalid WalletStandardChain: ${value} (expected solana:devnet | solana:mainnet)`,
    );
  }
  return trimmed as WalletStandardChain;
}
