import {
  COMMERCIAL_ACTIVE,
  commercialActive,
  type CommercialActiveStack,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import { productSvmRpcUrl } from "@/lib/web3/svm-rpc";
import { rpcUrlForChain } from "@/lib/web3/supported-chains";

/**
 * Pure Irys upload session plan — payment token + bundler class by commercial
 * namespace. `irys-client` executes this plan; it must not re-declare allowlists.
 *
 * Port §3.7 / П-8: user pays; SVM = Solana payment adapter of the same uploader.
 * Catalog is keyed by namespace (EVM: namespace ≡ EIP-155; SVM: reserved-band).
 */

export type IrysPaymentToken = "base-eth" | "ethereum" | "solana";

export type IrysNetworkClass = "devnet" | "mainnet";

export type IrysNamespaceConfig = {
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

/** Solana Devnet commercial namespace (LayerZero EID 40168 → reserved band). */
export const IRYS_SOLANA_DEVNET_NAMESPACE = 2_000_040_168;

/**
 * Irys payment admit table — key = commercial namespace.
 * Network class is declared per row (not a bare literal at the call site).
 */
const IRYS_BY_NAMESPACE: Readonly<Record<number, IrysNamespaceConfig>> = {
  84532: { paymentToken: "base-eth", network: "devnet" },
  11155111: { paymentToken: "ethereum", network: "devnet" },
  [IRYS_SOLANA_DEVNET_NAMESPACE]: {
    paymentToken: "solana",
    network: "devnet",
  },
};

function bundlerUrlForNetwork(network: IrysNetworkClass): string {
  return network === "mainnet" ? IRYS_MAINNET_BUNDLER_URL : IRYS_DEVNET_BUNDLER_URL;
}

export function irysUploadPlanRefusalMessage(cause: IrysUploadPlanCause): string {
  switch (cause) {
    case "wrong_vm":
      // Not a commercial stack we can pay from (or vm mismatch with registry).
      return "Irys uploads are not available on this network.";
    case "unsupported_network":
      return "Irys uploads are not configured for this network.";
    case "no_rpc":
      return "No RPC is configured for Irys uploads on this network.";
  }
}

function rpcUrlForStack(stack: CommercialActiveStack): string | null {
  if (stack.vm === "svm") {
    return productSvmRpcUrl();
  }
  try {
    return rpcUrlForChain(Number(stack.namespace));
  } catch {
    return null;
  }
}

/**
 * Fail-closed plan for a commercial stack.
 * Never throws — refusals are named causes.
 *
 * `registry` is injectable for constructed unsupported_network proofs
 * (same pattern as {@link commercialActive}).
 */
export function planIrysUpload(
  stack: CommercialActiveStack,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): IrysUploadPlanResult {
  const ns = Number(stack.namespace);
  const live = commercialActive(ns, registry);
  if (live == null || live.vm !== stack.vm) {
    return { ok: false, cause: "wrong_vm" };
  }

  const config = IRYS_BY_NAMESPACE[ns];
  if (!config) {
    return { ok: false, cause: "unsupported_network" };
  }

  const rpcUrl = rpcUrlForStack(stack);
  if (rpcUrl == null || rpcUrl.length === 0) {
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
