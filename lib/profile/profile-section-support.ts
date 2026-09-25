/**
 * Profile section availability from the subject's commercial namespaces.
 * Unserved sections refuse with SurfaceSupportCause product_owner_owed (D2 copy).
 * No VM-discriminant fork — EVM membership via {@link isCommercialEip155Id}.
 */

import {
  commercialActive,
  isCommercialEip155Id,
  type CommercialRegistry,
  COMMERCIAL_ACTIVE,
} from "@/lib/web3/commercial-active";
import {
  surfaceSupportCauseCopy,
  type SurfaceSupportCause,
} from "@/lib/web3/surface-support";

export const PROFILE_SECTION_IDS = [
  "passports",
  "listings",
  "verified",
  "attestations",
  "kar_pro",
  "delegated",
  "consigned",
  "outstanding",
  "claims",
  "saved",
] as const;

export type ProfileSectionId = (typeof PROFILE_SECTION_IDS)[number];

export type ProfileSectionSupport =
  | { readonly available: true }
  | { readonly available: false; readonly cause: "product_owner_owed" };

function subjectHasCommercialNamespace(
  namespaces: readonly number[],
  registry: CommercialRegistry,
): boolean {
  return namespaces.some((ns) => commercialActive(ns, registry) != null);
}

function subjectHasEvmNamespace(
  namespaces: readonly number[],
  registry: CommercialRegistry,
): boolean {
  return namespaces.some((ns) => isCommercialEip155Id(ns, registry));
}

/**
 * Whether a profile section has a product data source for this subject.
 * Passports: any commercial namespace (entity UNION). All other listed sections
 * need an EVM commercial namespace today.
 */
export function profileSectionSupport(
  section: ProfileSectionId,
  namespaces: readonly number[],
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): ProfileSectionSupport {
  switch (section) {
    case "passports":
      return subjectHasCommercialNamespace(namespaces, registry)
        ? { available: true }
        : { available: false, cause: "product_owner_owed" };
    case "listings":
    case "verified":
    case "attestations":
    case "kar_pro":
    case "delegated":
    case "consigned":
    case "outstanding":
    case "claims":
    case "saved":
      return subjectHasEvmNamespace(namespaces, registry)
        ? { available: true }
        : { available: false, cause: "product_owner_owed" };
    default: {
      const _exhaustive: never = section;
      return _exhaustive;
    }
  }
}

/** Non-empty refusal sentence for an unavailable section — D2 sole owner. */
export function profileSectionRefusalCopy(
  support: ProfileSectionSupport,
): string {
  if (support.available) return "";
  const cause: SurfaceSupportCause = support.cause;
  return surfaceSupportCauseCopy(cause);
}

/** Map every section id → support for a subject. */
export function profileSectionSupportMap(
  namespaces: readonly number[],
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): Readonly<Record<ProfileSectionId, ProfileSectionSupport>> {
  const map = {} as Record<ProfileSectionId, ProfileSectionSupport>;
  for (const id of PROFILE_SECTION_IDS) {
    map[id] = profileSectionSupport(id, namespaces, registry);
  }
  return map;
}
