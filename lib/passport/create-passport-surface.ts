/**
 * Create-passport surface — support before session.
 *
 * The network's census answer for `create_passport` is named first. Wallet-family
 * refusal appears only when that namespace admits creation. Second line (where
 * creation is available) is owned here beside the capability — never inlined in
 * the page. Nothing promises Solana will admit creation later.
 */

import {
  type ActiveAccount,
  commercialNamespaceOf,
  type EvmSessionCause,
  type WalletFamilyWanted,
} from "@/lib/web3/active-account";
import {
  commercialActive,
  COMMERCIAL_ACTIVE,
  registeredCommercialNamespaceIds,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import { commercialNetworkLabel } from "@/lib/web3/chain-selector-state";
import {
  surfaceSupport,
  surfaceSupportCauseCopy,
  type SurfaceSupportCause,
  type SurfaceSupportTable,
} from "@/lib/web3/surface-support";

export type CreatePassportNamespaceResult =
  | { readonly ok: true; readonly namespace: number }
  | {
      readonly ok: false;
      readonly cause: "disconnected" | "unresolved_namespace";
    };

/**
 * Target namespace for Create: commercial URL `?chain=` when present, else the
 * session commercial namespace, else disconnected / unresolved. Never invents a hub.
 */
export function resolveCreatePassportNamespace(input: {
  account: ActiveAccount;
  urlChain: number | null | undefined;
  registry?: CommercialRegistry;
}): CreatePassportNamespaceResult {
  const registry = input.registry ?? COMMERCIAL_ACTIVE;
  if (
    input.urlChain != null &&
    Number.isFinite(input.urlChain) &&
    commercialActive(input.urlChain, registry) != null
  ) {
    return { ok: true, namespace: input.urlChain };
  }
  const session = commercialNamespaceOf(input.account, registry);
  if (!session.ok) {
    return { ok: false, cause: session.cause };
  }
  return { ok: true, namespace: Number(session.namespace) };
}

export type CreatePassportAdmission =
  | {
      readonly status: "available";
      readonly namespace: number;
      readonly address: `0x${string}`;
      readonly chainId: number;
    }
  | {
      readonly status: "support_refused";
      readonly cause: SurfaceSupportCause;
      readonly namespace: number;
    }
  | {
      readonly status: "session_refused";
      readonly cause: EvmSessionCause;
      readonly wanted?: WalletFamilyWanted;
      readonly namespace: number;
    }
  | { readonly status: "unresolved_namespace" };

/**
 * Admit Create on `namespace`: census support first, then session.
 * Unsupported namespaces never surface a wallet-family sentence.
 */
export function admitCreatePassport(
  account: ActiveAccount,
  namespace: number,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
  table?: SurfaceSupportTable,
): CreatePassportAdmission {
  const support = surfaceSupport(
    "create_passport",
    namespace,
    registry,
    table,
  );
  if ("unresolved" in support) {
    return { status: "unresolved_namespace" };
  }
  if (!support.supported) {
    return {
      status: "support_refused",
      cause: support.cause,
      namespace,
    };
  }
  if (account.status !== "connected") {
    return {
      status: "session_refused",
      cause: "disconnected",
      namespace,
    };
  }
  if (account.vm !== support.family) {
    return {
      status: "session_refused",
      cause: "wrong_vm",
      wanted: support.family,
      namespace,
    };
  }
  if (account.vm !== "evm") {
    // create_passport supported family is always evm today; refuse by name if census changes.
    return {
      status: "session_refused",
      cause: "wrong_vm",
      wanted: "evm",
      namespace,
    };
  }
  return {
    status: "available",
    namespace,
    address: account.address,
    chainId: account.chainId,
  };
}

/**
 * Sole second sentence: commercial networks where `create_passport` is supported.
 * Empty when none admit (never invents a network name).
 */
export function createPassportWhereAvailableCopy(
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
  table?: SurfaceSupportTable,
): string {
  const labels = registeredCommercialNamespaceIds(registry)
    .filter((ns) => {
      const cell = surfaceSupport("create_passport", ns, registry, table);
      return !("unresolved" in cell) && cell.supported;
    })
    .map((ns) => commercialNetworkLabel(ns, registry));
  if (labels.length === 0) return "";
  if (labels.length === 1) {
    return `Creation is available on ${labels[0]}.`;
  }
  if (labels.length === 2) {
    return `Creation is available on ${labels[0]} and ${labels[1]}.`;
  }
  const head = labels.slice(0, -1).join(", ");
  const last = labels[labels.length - 1]!;
  return `Creation is available on ${head}, and ${last}.`;
}

export type CreatePassportSupportRefusalCopy = {
  readonly title: string;
  readonly detail: string;
};

/**
 * Support-refusal chrome for Create: census cause sentence + where-available line.
 * Title never empty. Detail may be empty when no commercial namespace admits creation.
 */
export function createPassportSupportRefusalCopy(
  cause: SurfaceSupportCause,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
  table?: SurfaceSupportTable,
): CreatePassportSupportRefusalCopy {
  return {
    title: surfaceSupportCauseCopy(cause),
    detail: createPassportWhereAvailableCopy(registry, table),
  };
}

/** Session chrome cause for admitting namespaces — maps to {@link EvmSessionRefusal}. */
export function createPassportSessionRefusalCause(
  admission: Extract<CreatePassportAdmission, { status: "session_refused" }>,
): EvmSessionCause {
  return admission.cause;
}
