/**
 * Sole surface admission composer — census (surfaceSupport) then session.
 * No second composer: create-passport and txWriteAvailabilityForCapability
 * adapt from this owner.
 */

import {
  type ActiveAccount,
  commercialNamespaceOf,
  type WalletFamilyWanted,
} from "@/lib/web3/active-account";
import {
  COMMERCIAL_ACTIVE,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import {
  isSurfaceClassCCapability,
  surfaceSupport,
  type SurfaceCapability,
  type SurfaceClassCCapability,
  type SurfaceSupportCause,
  type SurfaceSupportTable,
} from "@/lib/web3/surface-support";

export type SurfaceAdmission =
  | {
      readonly status: "available";
      readonly family: "evm";
      readonly namespace: number;
      readonly address: `0x${string}`;
      readonly chainId: number;
    }
  | {
      readonly status: "available";
      readonly family: "svm";
      readonly namespace: number;
    }
  | {
      readonly status: "support_refused";
      readonly cause: SurfaceSupportCause;
      readonly namespace: number;
    }
  | {
      readonly status: "family_required";
      readonly wanted: WalletFamilyWanted;
      readonly capability: SurfaceClassCCapability;
      readonly namespace: number;
    }
  | {
      readonly status: "wrong_family";
      readonly wanted: WalletFamilyWanted;
      readonly namespace: number;
    }
  | { readonly status: "disconnected" }
  | { readonly status: "unresolved_namespace" };

/**
 * Admit a capability on an explicit commercial namespace.
 * Order: census support → then session (disconnected / family).
 * Unsupported and unresolved win over disconnected.
 * Available packs narrowed session fields for adapters (no second account check).
 */
export function admitSurface(
  account: ActiveAccount,
  capability: SurfaceCapability,
  namespace: number,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
  table?: SurfaceSupportTable,
): SurfaceAdmission {
  const support = surfaceSupport(capability, namespace, registry, table);
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
    return { status: "disconnected" };
  }
  if (account.vm !== support.family) {
    if (isSurfaceClassCCapability(capability)) {
      return {
        status: "family_required",
        wanted: support.family,
        capability: capability as SurfaceClassCCapability,
        namespace,
      };
    }
    return {
      status: "wrong_family",
      wanted: support.family,
      namespace,
    };
  }
  // Session family already matches support.family; narrow for packed fields.
  if (account.vm === "evm") {
    return {
      status: "available",
      family: "evm",
      namespace,
      address: account.address,
      chainId: account.chainId,
    };
  }
  return {
    status: "available",
    family: "svm",
    namespace,
  };
}

/**
 * EVM address when admission is available on the EVM family.
 * Reads the packed admission — components must not compare `.family`.
 */
export function admitSurfaceEvmAddress(
  admission: SurfaceAdmission,
): `0x${string}` | undefined {
  if (admission.status === "available" && admission.family === "evm") {
    return admission.address;
  }
  return undefined;
}

/**
 * Whether an available admission may run EVM-keyed reads for this capability.
 * Components consume the boolean — they must not compare `.family`.
 */
export function admitSurfaceAllowsEvmRead(
  admission: SurfaceAdmission,
): boolean {
  return admission.status === "available" && admission.family === "evm";
}

/**
 * Chrome entry: namespace from the session commercial stack, then admit.
 * Disconnected / unresolved session namespace never invents a hub.
 */
export function admitSessionSurface(
  account: ActiveAccount,
  capability: SurfaceCapability,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
  table?: SurfaceSupportTable,
): SurfaceAdmission {
  const session = commercialNamespaceOf(account, registry);
  if (!session.ok) {
    if (session.cause === "disconnected") {
      return { status: "disconnected" };
    }
    return { status: "unresolved_namespace" };
  }
  return admitSurface(
    account,
    capability,
    Number(session.namespace),
    registry,
    table,
  );
}
