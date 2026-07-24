import { rpcUrlForChain } from "@/lib/web3/supported-chains";

/**
 * Pure Irys upload session plan — payment token + bundler class by wallet chainId.
 * `irys-client` executes this plan; it must not re-declare allowlists or invent tokens.
 *
 * Commercial testnets only. No mainnet rows until Phase 2 + RPC defaults.
 * No `@irys/*` imports here.
 */

export type IrysPaymentToken = "base-eth" | "ethereum";

export type IrysNetworkClass = "devnet" | "mainnet";

export type IrysChainConfig = {
  paymentToken: IrysPaymentToken;
  network: IrysNetworkClass;
};

export type IrysUploadPlan = {
  paymentToken: IrysPaymentToken;
  bundlerUrl: string;
  rpcUrl: string;
  /** Irys WebUploader `.devnet()` — required for Irys testnet bundler. */
  devnet: boolean;
};

export const IRYS_DEVNET_BUNDLER_URL = "https://devnet.irys.xyz";
export const IRYS_MAINNET_BUNDLER_URL = "https://node2.irys.xyz";

const IRYS_CHAINS: Readonly<Record<number, IrysChainConfig>> = {
  84532: { paymentToken: "base-eth", network: "devnet" },
  11155111: { paymentToken: "ethereum", network: "devnet" },
};

function bundlerUrlForNetwork(network: IrysNetworkClass): string {
  return network === "mainnet" ? IRYS_MAINNET_BUNDLER_URL : IRYS_DEVNET_BUNDLER_URL;
}

export function isIrysSupportedChain(chainId: number): boolean {
  return IRYS_CHAINS[chainId] != null;
}

export function supportedIrysChainIds(): readonly number[] {
  return Object.keys(IRYS_CHAINS).map(Number);
}

/**
 * Fail-closed plan for a wallet `eth_chainId`.
 * Throws when the chain is not in the registry or has no RPC.
 */
export function planIrysUpload(chainId: number): IrysUploadPlan {
  const config = IRYS_CHAINS[chainId];
  if (!config) {
    throw new Error(`Unsupported chain for Irys uploads: ${chainId}`);
  }
  return {
    paymentToken: config.paymentToken,
    bundlerUrl: bundlerUrlForNetwork(config.network),
    rpcUrl: rpcUrlForChain(chainId),
    devnet: config.network === "devnet",
  };
}
