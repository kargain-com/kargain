/**
 * Sole surface admission composer — census (surfaceSupport) then session.
 * No second composer: create-passport and txWriteAvailabilityForCapability
 * adapt from this owner.
 *
 * Refusal half has one sentence owner ({@link surfaceAdmissionRefusalCopy})
 * and one chrome component (components/shell/surface-admission-refusal).
 */

import {
  type ActiveAccount,
  commercialNamespaceOf,
  wrongVmActionCopy,
  type WalletFamilyWanted,
} from "@/lib/web3/active-account";
import {
  COMMERCIAL_ACTIVE,
  unresolvedNamespaceCopy,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import {
  isSurfaceClassCCapability,
  surfaceClassCCauseCopy,
  surfaceSupport,
  surfaceSupportCauseCopy,
  type SurfaceCapability,
  type SurfaceClassCCapability,
  type SurfaceSupportCause,
  type SurfaceSupportTable,
} from "@/lib/web3/surface-support";

/** Refusal half of SurfaceAdmission — one union, one sentence owner. */
export type SurfaceAdmissionRefusal =
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

export type SurfaceAdmissionAvailable =
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
    };

export type SurfaceAdmission =
  | SurfaceAdmissionAvailable
  | SurfaceAdmissionRefusal;

/** Session entry — wrong_family absent (unreachable via admitSessionSurface). */
export type SessionSurfaceAdmission = Exclude<
  SurfaceAdmission,
  { readonly status: "wrong_family" }
>;

/** Session refusal — available excluded. */
export type SessionSurfaceAdmissionRefusal = Exclude<
  SessionSurfaceAdmission,
  SurfaceAdmissionAvailable
>;

export type SurfaceAdmissionRefusalCopy = {
  readonly title: string;
  readonly description: string;
};

const DEFAULT_DISCONNECTED_TITLE = "Connect a wallet to continue.";

/**
 * Sole sentence owner for {@link SurfaceAdmissionRefusal}.
 * Surface-specific `disconnectedTitle` applies only to `disconnected` (§4.7).
 */
export function surfaceAdmissionRefusalCopy(
  refusal: SurfaceAdmissionRefusal,
  opts?: { readonly disconnectedTitle?: string },
): SurfaceAdmissionRefusalCopy {
  switch (refusal.status) {
    case "support_refused":
      return {
        title: surfaceSupportCauseCopy(refusal.cause),
        description: "",
      };
    case "family_required":
      return {
        title: surfaceClassCCauseCopy(refusal.capability),
        description: "",
      };
    case "wrong_family":
      return {
        title: wrongVmActionCopy(refusal.wanted),
        description: "",
      };
    case "unresolved_namespace":
      return { title: unresolvedNamespaceCopy(), description: "" };
    case "disconnected":
      return {
        title: opts?.disconnectedTitle ?? DEFAULT_DISCONNECTED_TITLE,
        description: "",
      };
    default: {
      const _exhaustive: never = refusal;
      return _exhaustive;
    }
  }
}

/** Narrow available — chrome gates CTAs without comparing refusal statuses. */
export function isSurfaceAdmissionAvailable(
  admission: SurfaceAdmission,
): admission is SurfaceAdmissionAvailable {
  return admission.status === "available";
}

/** Narrow refusal — for the shell component and fact carriers. */
export function isSurfaceAdmissionRefusal(
  admission: SurfaceAdmission,
): admission is SurfaceAdmissionRefusal {
  return admission.status !== "available";
}

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
 * EVM address + chainId when admission is available on the EVM family.
 * Reads the packed admission — components must not compare `.family`.
 */
export function admitSurfaceEvmPacked(
  admission: SurfaceAdmission,
): { readonly address: `0x${string}`; readonly chainId: number } | undefined {
  if (admission.status === "available" && admission.family === "evm") {
    return { address: admission.address, chainId: admission.chainId };
  }
  return undefined;
}

/**
 * EVM address when admission is available on the EVM family.
 * Reads the packed admission — components must not compare `.family`.
 */
export function admitSurfaceEvmAddress(
  admission: SurfaceAdmission,
): `0x${string}` | undefined {
  return admitSurfaceEvmPacked(admission)?.address;
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
 * Return type excludes `wrong_family` (unreachable via session ns).
 */
export function admitSessionSurface(
  account: ActiveAccount,
  capability: SurfaceCapability,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
  table?: SurfaceSupportTable,
): SessionSurfaceAdmission {
  const session = commercialNamespaceOf(account, registry);
  if (!session.ok) {
    if (session.cause === "disconnected") {
      return { status: "disconnected" };
    }
    return { status: "unresolved_namespace" };
  }
  const admission = admitSurface(
    account,
    capability,
    Number(session.namespace),
    registry,
    table,
  );
  // Session namespace always matches session family — wrong_family unreachable.
  return admission as SessionSurfaceAdmission;
}
