import type { CommercialActiveStack } from "@/lib/web3/commercial-active";
import { rpcUrlForChain } from "@/lib/web3/supported-chains";

/**
 * Pure Irys upload session plan — payment token + bundler class by commercial stack.
 * `irys-client` executes this plan; it must not re-declare allowlists or invent tokens.
 *
 * Commercial EVM testnets only. SVM is still staged behind named `wrong_vm`
 * until a commercial Solana registry row makes the planner produce `"solana"`.
 * The Solana payment adapter now exists; this module remains pure and keeps
 * all `@irys/*` imports out of the planning path.
 */

export type IrysPaymentToken = "base-eth" | "ethereum" | "solana";

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

export type IrysUploadPlanCause =
  | "wrong_vm"
  | "unsupported_network"
  | "no_rpc";

export type IrysUploadPlanResult =
  | { ok: true; plan: IrysUploadPlan }
  | { ok: false; cause: IrysUploadPlanCause };

export const IRYS_DEVNET_BUNDLER_URL = "https://devnet.irys.xyz";
export const IRYS_MAINNET_BUNDLER_URL = "https://node2.irys.xyz";

const IRYS_EVM_CHAINS: Readonly<Record<number, IrysChainConfig>> = {
  84532: { paymentToken: "base-eth", network: "devnet" },
  11155111: { paymentToken: "ethereum", network: "devnet" },
};

function bundlerUrlForNetwork(network: IrysNetworkClass): string {
  return network === "mainnet" ? IRYS_MAINNET_BUNDLER_URL : IRYS_DEVNET_BUNDLER_URL;
}

export function isIrysSupportedChain(chainId: number): boolean {
  return IRYS_EVM_CHAINS[chainId] != null;
}

export function supportedIrysChainIds(): readonly number[] {
  return Object.keys(IRYS_EVM_CHAINS).map(Number);
}

export function irysUploadPlanRefusalMessage(cause: IrysUploadPlanCause): string {
  switch (cause) {
    case "wrong_vm":
      return "Irys uploads are not available on this wallet family yet.";
    case "unsupported_network":
      return "Irys uploads are not configured for this network.";
    case "no_rpc":
      return "No RPC is configured for Irys uploads on this network.";
  }
}

/**
 * Fail-closed plan for a commercial stack.
 * Never throws — refusals are named causes.
 */
export function planIrysUpload(
  stack: CommercialActiveStack,
): IrysUploadPlanResult {
  if (stack.vm !== "evm") {
    return { ok: false, cause: "wrong_vm" };
  }

  const config = IRYS_EVM_CHAINS[stack.chainId];
  if (!config) {
    return { ok: false, cause: "unsupported_network" };
  }

  let rpcUrl: string;
  try {
    rpcUrl = rpcUrlForChain(stack.chainId);
  } catch {
    return { ok: false, cause: "no_rpc" };
  }

  return {
    ok: true,
    plan: {
      paymentToken: config.paymentToken,
      bundlerUrl: bundlerUrlForNetwork(config.network),
      rpcUrl,
      devnet: config.network === "devnet",
    },
  };
}
