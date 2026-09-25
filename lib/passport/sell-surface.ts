import {
  AVAILABLE,
  blocked,
  type ActionGate,
} from "@/lib/challenge/action-gate";
import type { MandateSnapshot } from "@/lib/commerce/mandate";
import { isMandateExpired, mandateHasAgent } from "@/lib/commerce/mandate";
import type { CommerceMode } from "@/lib/commerce/mode";
import {
  commerceFactCauseCopy,
  type CommerceFact,
  type CommerceFactCause,
} from "@/lib/passport/commerce-fact";
import {
  isEncumbrancePermissionAvailable,
  type EncumbrancePermissionGate,
} from "@/lib/passport/encumbrance-permission";
import type { PassportStatus } from "@/lib/types/ponder";

/** Named cause when KarPro self-open is visible but refused (Bridge-style dimmed CTA). */
export type AscendingSelfOpenCause = "not_verified";

export type SellSurfaceFlags = {
  /** Open a fixed-price consignment directly. */
  showFixedPriceOpen: boolean;
  /** Grant a fixed-price mandate to a KarPro agent. */
  showFixedPriceGrant: boolean;
  /** Manage an existing fixed-price mandate. */
  showFixedPriceMandateCard: boolean;
  /**
   * KarPro ascending self-open: `null` hidden; available → create form;
   * blocked `not_verified` → dimmed Auction + status (feature exists, needs verify).
   */
  ascendingSelfOpen: ActionGate<AscendingSelfOpenCause> | null;
  /** Grant an ascending mandate so a KarPro can run the lot (status-free). */
  showAscendingGrant: boolean;
  showAscendingMandateCard: boolean;
  /** Quiet note: ascending requires a KarPro runner. */
  showAscendingRunnerNote: boolean;
};

/**
 * Sell-only closed causes. Live/mandate refusals carry `CommerceFactCause`
 * directly.
 */
export type SellSurfaceClosedCause =
  | "not_owner"
  | "live_consignment"
  | "live_pending"
  | "permission_blocked";

export type SellSurfaceResult = SellSurfaceFlags & {
  /** Null when CTAs may show; set when fail-closed. */
  closedCause: SellSurfaceClosedCause | CommerceFactCause | null;
};

/** A mandate read together with the clock used to judge its expiry. */
export type MandateState = {
  /** `null` means a successful read with no mandate. */
  value: MandateSnapshot | null;
  now: number;
};

export type SellSurfaceInput = {
  isOwner: boolean;
  /**
   * Live-lot fact — known false is the only value that admits sell CTAs.
   * Pending and refused fail closed and carry the cause.
   */
  hasLiveConsignment: CommerceFact<boolean>;
  /** Mode contracts deployed on this chain (registry). */
  fixedPriceConfigured: boolean;
  ascendingConfigured: boolean;
  /** `may(tokenId, OpenConsignment)` gate — sole permission answer. */
  openConsignmentPermission: EncumbrancePermissionGate;
  /** `undefined` means the staking read is unresolved. */
  isActiveVerifier: boolean | undefined;
  /**
   * Passport trust status. `undefined` means unread — ascending open fails closed;
   * fixed-price flags ignore status.
   */
  passportStatus: PassportStatus | undefined;
  /** Mandate facts — pending/refused fail closed for grant/card. */
  fixedPriceMandate: CommerceFact<MandateSnapshot | null>;
  ascendingMandate: CommerceFact<MandateSnapshot | null>;
  /** Wall-clock for expiry when mandate is known. */
  now: number;
};

const HIDDEN_FLAGS: SellSurfaceFlags = {
  showFixedPriceOpen: false,
  showFixedPriceGrant: false,
  showFixedPriceMandateCard: false,
  ascendingSelfOpen: null,
  showAscendingGrant: false,
  showAscendingMandateCard: false,
  showAscendingRunnerNote: false,
};

function hidden(closedCause: SellSurfaceResult["closedCause"]): SellSurfaceResult {
  return { ...HIDDEN_FLAGS, closedCause };
}

type MandateStanding = "none" | "active" | "expired";

function mandateStanding(
  mandate: MandateSnapshot | null,
  now: number,
): MandateStanding {
  if (!mandateHasAgent(mandate)) return "none";
  return isMandateExpired(mandate, now) ? "expired" : "active";
}

/**
 * Pure owner sell-surface policy for the mode contracts.
 *
 * Encumbrance permission comes from `may(OpenConsignment)` and live-consignment
 * custody. Fixed-price open/grant ignore trust status. Ascending **self-open**
 * requires VERIFIED (mirrors chain); ascending **grant** stays status-free.
 * KarPro + known non-VERIFIED keeps a blocked self-open gate so the Auction CTA
 * stays visible (dimmed) with a named cause — same pattern as Bridge.
 */
export function deriveSellSurface(input: SellSurfaceInput): SellSurfaceResult {
  if (!input.isOwner) {
    return hidden("not_owner");
  }

  const live = input.hasLiveConsignment;
  if (live.status === "pending") {
    return hidden("live_pending");
  }
  if (live.status === "refused") {
    return hidden(live.cause);
  }
  if (live.value) {
    return hidden("live_consignment");
  }

  if (!isEncumbrancePermissionAvailable(input.openConsignmentPermission)) {
    return hidden("permission_blocked");
  }

  const fpMandate = input.fixedPriceMandate;
  const ascMandate = input.ascendingMandate;
  if (fpMandate.status === "refused") {
    return hidden(fpMandate.cause);
  }
  if (ascMandate.status === "refused") {
    return hidden(ascMandate.cause);
  }

  const fixedPriceKnown = fpMandate.status === "known";
  const ascendingKnown = ascMandate.status === "known";
  const fixedPriceStanding = fixedPriceKnown
    ? mandateStanding(fpMandate.value, input.now)
    : "none";
  const ascendingStanding = ascendingKnown
    ? mandateStanding(ascMandate.value, input.now)
    : "none";

  const fixedPriceFree =
    input.fixedPriceConfigured &&
    fixedPriceKnown &&
    fixedPriceStanding === "none";
  const ascendingFree =
    input.ascendingConfigured &&
    ascendingKnown &&
    ascendingStanding === "none";

  const verified = input.passportStatus === "VERIFIED";
  const statusKnown = input.passportStatus !== undefined;

  let ascendingSelfOpen: ActionGate<AscendingSelfOpenCause> | null = null;
  if (ascendingFree && input.isActiveVerifier === true) {
    if (statusKnown) {
      ascendingSelfOpen = verified ? AVAILABLE : blocked("not_verified");
    }
  }

  return {
    showFixedPriceOpen: input.fixedPriceConfigured,
    showFixedPriceGrant: fixedPriceFree,
    showFixedPriceMandateCard:
      input.fixedPriceConfigured &&
      fixedPriceKnown &&
      fixedPriceStanding !== "none",
    ascendingSelfOpen,
    showAscendingGrant: ascendingFree && input.isActiveVerifier === false,
    showAscendingMandateCard:
      input.ascendingConfigured &&
      ascendingKnown &&
      ascendingStanding !== "none",
    showAscendingRunnerNote:
      input.ascendingConfigured && input.isActiveVerifier === false,
    closedCause: null,
  };
}

/**
 * Chrome for a carried sell closed-cause. Never empty. Waiting (`live_pending`)
 * is waiting copy, never a refusal sentence. `permission_blocked` is a fallback
 * when the panel already rendered the live gate; it must not invent a definite
 * refused/unanswerable claim.
 */
export function sellSurfaceClosedCopy(
  cause: SellSurfaceClosedCause | CommerceFactCause,
): string {
  switch (cause) {
    case "not_owner":
      return "Only the passport owner can list or authorize a sale.";
    case "live_consignment":
      return "This passport is already in a live consignment.";
    case "live_pending":
      return "Waiting for consignment status…";
    case "permission_blocked":
      return "Waiting for chain permission…";
    case "rpc_unavailable":
    case "account_not_found":
    case "malformed_response":
    case "unresolved_namespace":
    case "evm_call_failed":
    case "not_in_program":
    case "product_owner_owed":
    case "authority_only":
      return commerceFactCauseCopy(cause);
    default: {
      const _exhaustive: never = cause;
      return _exhaustive;
    }
  }
}

export function sellModeLabel(mode: CommerceMode): string {
  return mode === "fixedPrice" ? "Fixed price" : "Ascending auction";
}
