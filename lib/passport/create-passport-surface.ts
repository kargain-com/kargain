/**
 * Create-passport surface — support before session.
 *
 * Admits via {@link admitSurface} (SurfaceAdmission). Where-available line
 * stays beside the capability — never inlined in the page. Nothing promises
 * Solana will admit creation later.
 */

import {
  type ActiveAccount,
  commercialNamespaceOf,
} from "@/lib/web3/active-account";
import {
  commercialActive,
  COMMERCIAL_ACTIVE,
  registeredCommercialNamespaceIds,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import { commercialNetworkLabel } from "@/lib/web3/chain-selector-state";
import {
  admitSurface,
  type SurfaceAdmission,
  type SurfaceAdmissionRefusal,
} from "@/lib/web3/surface-admission";
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

/**
 * Admit Create on `namespace`: census support first, then session
 * via {@link admitSurface}. Unsupported namespaces never surface a
 * wallet-family sentence.
 */
export function admitCreatePassport(
  account: ActiveAccount,
  namespace: number,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
  table?: SurfaceSupportTable,
): SurfaceAdmission {
  return admitSurface(account, "create_passport", namespace, registry, table);
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

/**
 * Extra EmptyState description for Create refusals — where-available only on
 * support_refused (status compare lives here, not in chrome).
 */
export function createPassportAdmissionDetail(
  refusal: SurfaceAdmissionRefusal,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
  table?: SurfaceSupportTable,
): string | undefined {
  if (refusal.status !== "support_refused") return undefined;
  const detail = createPassportWhereAvailableCopy(registry, table);
  return detail === "" ? undefined : detail;
}

/** Whether Create chrome should show the mint intro above the refusal. */
export function createPassportShowsMintIntro(
  refusal: SurfaceAdmissionRefusal,
): boolean {
  return (
    refusal.status === "disconnected" ||
    refusal.status === "family_required" ||
    refusal.status === "wrong_family"
  );
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
