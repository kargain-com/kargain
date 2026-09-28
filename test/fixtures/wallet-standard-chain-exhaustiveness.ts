/**
 * Type-level plant: svmWalletStandardChainLabel switch must cover every
 * WalletStandardChainValue. Missing solana:mainnet is intentionally under
 * @ts-expect-error so pnpm typecheck stays green while the expect-error
 * remains required. Policy suite strips the directive → tsc red.
 */
import type { WalletStandardChain } from "@/lib/web3/wallet-standard-chain";

export function svmWalletStandardChainLabelMissingMainnet(
  chain: WalletStandardChain,
): string {
  switch (chain) {
    case "solana:devnet":
      return "Solana Devnet";
    // solana:mainnet omitted
    default: {
      // @ts-expect-error — missing solana:mainnet case must fail never assignability
      const _exhaustive: never = chain;
      return _exhaustive;
    }
  }
}
