/**
 * Create-passport surface — support before session.
 *
 * Admits via {@link admitSurface} (SurfaceAdmission). Dual-VM census:
 * create_passport is supported on every commercial network.
 */

import {
  type ActiveAccount,
  commercialNamespaceOf,
} from "@/lib/web3/active-account";
import {
  commercialActive,
  COMMERCIAL_ACTIVE,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import {
  admitSurface,
  type SurfaceAdmission,
  type SurfaceAdmissionRefusal,
} from "@/lib/web3/surface-admission";
import { type SurfaceSupportTable } from "@/lib/web3/surface-support";

export type CreatePassportNamespaceResult =
  | { readonly ok: true; readonly namespace: number }
  | {
      readonly ok: false;
      readonly cause: "disconnected" | "unresolved_namespace";
    };

/** Sole intro sentence above Create chrome (mint form / refusal). */
export function createPassportIntroCopy(): string {
  return "Mint a KarPassport NFT with basic vehicle details and photos stored on Arweave.";
}

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
