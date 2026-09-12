/**
 * Branded Wallet Standard cluster identifier for commercial SVM stacks.
 * Mint at registry ingress only — same shape as {@link ExplorerOrigin}.
 */

declare const walletStandardChainBrand: unique symbol;

export type WalletStandardChain = string & {
  readonly [walletStandardChainBrand]: void;
};

const ALLOWED = new Set(["solana:devnet", "solana:mainnet"]);

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
