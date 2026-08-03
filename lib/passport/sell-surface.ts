import {
  AVAILABLE,
  blocked,
  type ActionGate,
} from "@/lib/challenge/action-gate";
import type { MandateSnapshot } from "@/lib/commerce/mandate";
import { isMandateExpired, mandateHasAgent } from "@/lib/commerce/mandate";
import type { CommerceMode } from "@/lib/commerce/mode";
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

/** A mandate read together with the clock used to judge its expiry. */
export type MandateState = {
  /** `null` means a successful read with no mandate. */
  value: MandateSnapshot | null;
  now: number;
};

export type SellSurfaceInput = {
  isOwner: boolean;
  /**
   * `true` when any mode still holds this passport (offered, bidding, or under
   * settlement hold). `undefined` means unresolved — fail closed.
   */
  hasLiveConsignment: boolean | undefined;
  /** Mode contracts deployed on this chain. */
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
  /** `undefined` means the mandate read is unresolved. */
  fixedPriceMandate: MandateState | undefined;
  ascendingMandate: MandateState | undefined;
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

type MandateStanding = "none" | "active" | "expired";

function mandateStanding(state: MandateState | undefined): MandateStanding {
  if (!state) return "none";
  const mandate = state.value;
  if (!mandateHasAgent(mandate)) return "none";
  return isMandateExpired(mandate, state.now) ? "expired" : "active";
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
export function deriveSellSurface(input: SellSurfaceInput): SellSurfaceFlags {
  if (!input.isOwner || input.hasLiveConsignment !== false) {
    return { ...HIDDEN_FLAGS };
  }
  if (!isEncumbrancePermissionAvailable(input.openConsignmentPermission)) {
    return { ...HIDDEN_FLAGS };
  }

  const fixedPriceStanding = mandateStanding(input.fixedPriceMandate);
  const ascendingStanding = mandateStanding(input.ascendingMandate);
  const fixedPriceKnown = input.fixedPriceMandate !== undefined;
  const ascendingKnown = input.ascendingMandate !== undefined;

  const fixedPriceFree =
    input.fixedPriceConfigured && fixedPriceKnown && fixedPriceStanding === "none";
  const ascendingFree =
    input.ascendingConfigured && ascendingKnown && ascendingStanding === "none";

  const verified = input.passportStatus === "VERIFIED";
  const statusKnown = input.passportStatus !== undefined;

  let ascendingSelfOpen: ActionGate<AscendingSelfOpenCause> | null = null;
  if (ascendingFree && input.isActiveVerifier === true) {
    if (statusKnown) {
      ascendingSelfOpen = verified
        ? AVAILABLE
        : blocked("not_verified");
    }
  }

  return {
    showFixedPriceOpen: input.fixedPriceConfigured,
    showFixedPriceGrant: fixedPriceFree,
    showFixedPriceMandateCard:
      input.fixedPriceConfigured && fixedPriceKnown && fixedPriceStanding !== "none",
    ascendingSelfOpen,
    showAscendingGrant: ascendingFree && input.isActiveVerifier === false,
    showAscendingMandateCard:
      input.ascendingConfigured && ascendingKnown && ascendingStanding !== "none",
    showAscendingRunnerNote:
      input.ascendingConfigured && input.isActiveVerifier === false,
  };
}

export function sellModeLabel(mode: CommerceMode): string {
  return mode === "fixedPrice" ? "Fixed price" : "Ascending auction";
}
