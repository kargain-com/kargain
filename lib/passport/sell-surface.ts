import type { MandateSnapshot } from "@/lib/commerce/mandate";
import { isMandateExpired, mandateHasAgent } from "@/lib/commerce/mandate";
import type { CommerceMode } from "@/lib/commerce/mode";
import {
  isEncumbrancePermissionAvailable,
  type EncumbrancePermissionGate,
} from "@/lib/passport/encumbrance-permission";

export type SellSurfaceFlags = {
  /** Open a fixed-price consignment directly. */
  showFixedPriceOpen: boolean;
  /** Grant a fixed-price mandate to a KarPro agent. */
  showFixedPriceGrant: boolean;
  /** Manage an existing fixed-price mandate. */
  showFixedPriceMandateCard: boolean;
  /** Open an ascending consignment directly (owner must be an active KarPro). */
  showAscendingOpen: boolean;
  /** Grant an ascending mandate so a KarPro can run the lot. */
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
  /** `undefined` means the mandate read is unresolved. */
  fixedPriceMandate: MandateState | undefined;
  ascendingMandate: MandateState | undefined;
};

const HIDDEN_FLAGS: SellSurfaceFlags = {
  showFixedPriceOpen: false,
  showFixedPriceGrant: false,
  showFixedPriceMandateCard: false,
  showAscendingOpen: false,
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
 * Permission comes from `may(OpenConsignment)` and live-consignment custody —
 * never from the passport trust status. An expired-but-present mandate stays a
 * management card so the owner can revoke it.
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

  return {
    showFixedPriceOpen: input.fixedPriceConfigured,
    showFixedPriceGrant: fixedPriceFree,
    showFixedPriceMandateCard:
      input.fixedPriceConfigured && fixedPriceKnown && fixedPriceStanding !== "none",
    showAscendingOpen: ascendingFree && input.isActiveVerifier === true,
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
