import type { CommerceMode } from "@/lib/commerce/mode";
import type {
  CommerceFact,
  SurfaceSupportCause,
} from "@/lib/passport/commerce-fact";
import {
  encumbrancePermissionCopy,
  isEncumbrancePermissionAvailable,
  type EncumbrancePermissionGate,
} from "@/lib/passport/encumbrance-permission";
import {
  derivePassportPresence,
  passportAwayActionCopy,
  presenceBlocksWrites,
  type CustodyLockRead,
  type PassportPresence,
} from "@/lib/passport/presence";
import { bridgeCounterpartChainId } from "@/lib/web3/bridge";
import type { Address } from "viem";

export type BridgeBlockReason =
  | "consigned"
  | "challenged"
  | "refused"
  | "unresolved"
  | "source_unanswerable"
  | SurfaceSupportCause;

export type BridgeSurfaceMode = "hidden" | "action";

export type BridgeSurfaceResult = {
  visible: boolean;
  mode: BridgeSurfaceMode;
  canBridge: boolean;
  blockReason: BridgeBlockReason | null;
  /** Set when `blockReason` is `source_unanswerable`. */
  unanswerableSource: Address | null;
  /**
   * Location answer from presence (§4.21). Null when here or when the panel
   * is hidden. Fold gaps and lock-unread never become `blockReason: "unresolved"`.
   */
  location: PassportPresence | null;
  /** §4.21 chrome when location blocks the send; empty when null/here. */
  locationCopy: string | null;
};

export type BridgeSurfaceInput = {
  isOwner: boolean;
  /** Custody chain — where the token lives now. */
  chainId: number;
  /**
   * `may(tokenId, LeaveChain)` gate — the authoritative leave permission.
   */
  leaveChainPermission?: EncumbrancePermissionGate;
  /**
   * Live consignment mode fact — only `known` with a mode refines "consigned"
   * copy; pending/refused never invent consigned.
   */
  liveConsignmentMode?: CommerceFact<CommerceMode | null>;
  /**
   * Challenge-open fact — only `known` + true yields "challenged";
   * pending/refused never invent challenged.
   */
  challengeOpen?: CommerceFact<boolean>;
  /**
   * Active bridge transit for this token (src burn/lock — wallet may no longer
   * own the NFT). Keeps the panel visible with canBridge false.
   */
  transitActive?: boolean;
  /**
   * Fold incomplete cause from the indexer. Honest input only — never invent
   * a lock read or custody chain to accompany it.
   */
  custodyUnresolved?: string | null;
  /**
   * On-chain custody lock as a fact. Omit → pending (nothing was read —
   * never invent unlocked).
   */
  custodyLock?: CustodyLockRead;
  /** Ponder custody when known — optional; omit when unread. */
  ponderCustodyChain?: number | null;
};

const HIDDEN: BridgeSurfaceResult = {
  visible: false,
  mode: "hidden",
  canBridge: false,
  blockReason: null,
  unanswerableSource: null,
  location: null,
  locationCopy: null,
};

/**
 * Pure owner bridge-surface policy. Unknown listing/auction facts fail closed.
 * Action is available on either star chain (hub or spoke) when custody is there.
 */
const TRANSIT_VISIBLE: BridgeSurfaceResult = {
  visible: true,
  mode: "action",
  canBridge: false,
  blockReason: null,
  unanswerableSource: null,
  location: null,
  locationCopy: null,
};

function locationFields(
  input: BridgeSurfaceInput,
): Pick<BridgeSurfaceResult, "location" | "locationCopy"> {
  const custodyLock: CustodyLockRead =
    input.custodyLock ?? { status: "pending" };
  const presence = derivePassportPresence({
    viewChainId: input.chainId,
    custodyLock,
    ponderCustodyChain: input.ponderCustodyChain,
    custodyUnresolved: input.custodyUnresolved ?? null,
  });
  if (!presenceBlocksWrites(presence)) {
    return { location: presence, locationCopy: null };
  }
  return {
    location: presence,
    locationCopy: passportAwayActionCopy(presence),
  };
}

function withLocation(
  base: Omit<BridgeSurfaceResult, "location" | "locationCopy">,
  input: BridgeSurfaceInput,
): BridgeSurfaceResult {
  const loc = locationFields(input);
  const locationBlocks = loc.locationCopy != null;
  return {
    ...base,
    ...loc,
    canBridge: locationBlocks ? false : base.canBridge,
  };
}

/**
 * Sole owner bridge-surface policy — including §4.21 location.
 * Fold gaps and leave-permission unread stay distinct.
 */
export function deriveBridgeSurface(
  input: BridgeSurfaceInput,
): BridgeSurfaceResult {
  if (!input.isOwner) {
    // In-flight: NFT may be burned/locked — keep transit chrome visible.
    if (input.transitActive) {
      return withLocation({ ...TRANSIT_VISIBLE }, input);
    }
    return { ...HIDDEN };
  }

  if (bridgeCounterpartChainId(input.chainId) == null) {
    if (input.transitActive) {
      return withLocation({ ...TRANSIT_VISIBLE }, input);
    }
    return { ...HIDDEN };
  }

  const loc = locationFields(input);
  const locationBlocks = loc.locationCopy != null;

  // Fold / lock-unread: named §4.21 copy; never leave-permission `unresolved`.
  if (locationBlocks) {
    return {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: null,
      unanswerableSource: null,
      ...loc,
    };
  }

  if (input.leaveChainPermission == null) {
    if (input.transitActive) {
      return {
        ...TRANSIT_VISIBLE,
        ...loc,
      };
    }
    return { ...HIDDEN };
  }

  const gate = input.leaveChainPermission;

  if (gate.status === "blocked" && gate.cause === "reads_unresolved") {
    return {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: "unresolved",
      unanswerableSource: null,
      ...loc,
    };
  }

  if (gate.status === "blocked" && gate.cause === "source_unanswerable") {
    return {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: "source_unanswerable",
      unanswerableSource: gate.source,
      ...loc,
    };
  }

  if (
    gate.status === "blocked" &&
    (gate.cause === "product_owner_owed" ||
      gate.cause === "not_in_program" ||
      gate.cause === "authority_only")
  ) {
    // Support refusal — named cause, never mapped to waiting (`unresolved`).
    return {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: gate.cause,
      unanswerableSource: null,
      ...loc,
    };
  }

  if (gate.status === "blocked" && gate.cause === "refused") {
    // Challenge first: it outranks commerce when both apply.
    // Only known facts refine copy — pending/refused never invent challenged/consigned.
    const challengeKnownOpen =
      input.challengeOpen?.status === "known" && input.challengeOpen.value;
    const consignedKnown =
      input.liveConsignmentMode?.status === "known" &&
      input.liveConsignmentMode.value != null;
    const reason: BridgeBlockReason = challengeKnownOpen
      ? "challenged"
      : consignedKnown
        ? "consigned"
        : "refused";
    return {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: reason,
      unanswerableSource: null,
      ...loc,
    };
  }

  if (input.transitActive) {
    return {
      ...TRANSIT_VISIBLE,
      ...loc,
    };
  }

  if (!isEncumbrancePermissionAvailable(gate)) {
    return {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: "unresolved",
      unanswerableSource: null,
      ...loc,
    };
  }

  return {
    visible: true,
    mode: "action",
    canBridge: true,
    blockReason: null,
    unanswerableSource: null,
    ...loc,
  };
}

export function bridgeBlockReasonCopy(
  reason: BridgeBlockReason,
  unanswerableSource: Address | null = null,
): string {
  switch (reason) {
    case "consigned":
      return "Close the open consignment before bridging.";
    case "challenged":
      return "Resolve the open challenge before bridging.";
    case "refused":
      return encumbrancePermissionCopy(
        { status: "blocked", cause: "refused" },
        "leaveChain",
      );
    case "unresolved":
      return encumbrancePermissionCopy(
        { status: "blocked", cause: "reads_unresolved" },
        "leaveChain",
      );
    case "source_unanswerable":
      return encumbrancePermissionCopy(
        unanswerableSource != null
          ? {
              status: "blocked",
              cause: "source_unanswerable",
              source: unanswerableSource,
            }
          : { status: "blocked", cause: "reads_unresolved" },
        "leaveChain",
      );
    case "product_owner_owed":
    case "not_in_program":
    case "authority_only":
      // D2 names these at the control — empty this unit (no wait-as-refusal).
      return encumbrancePermissionCopy(
        { status: "blocked", cause: reason },
        "leaveChain",
      );
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

/**
 * Term of a crossing (X2) — shown before send when the passport is VERIFIED.
 * Plain disclosure, not an alarm. Requires explicit ack before the send CTA.
 */
export const CROSSING_TRUST_DISCLOSURE =
  "Verification does not travel. After you send, the passport begins unverified on the destination chain. Returning home clears verification on this chain too — a verification is a statement by a professional whose stake lives on one chain. You can still list at a fixed price while unverified; reserve auctions need a fresh verification.";

/** Shorter crossing note when the passport is not currently VERIFIED. */
export const CROSSING_UNVERIFIED_DISCLOSURE =
  "Verification does not travel. The passport arrives unverified on the destination chain.";

export type BridgeCrossingConsent = {
  disclosure: string;
  /** When true, the send CTA stays disabled until the owner acknowledges. */
  requiresAck: boolean;
};

/**
 * Bridge disclosure + ack gate from current trust status.
 * VERIFIED → full loss-of-verification disclosure + required ack.
 * Otherwise → short disclosure, no ack (never frames a never-verified passport as losing VERIFIED).
 */
export function deriveBridgeCrossingConsent(
  passportStatus: "UNVERIFIED" | "VERIFIED" | "DISPUTED" | undefined,
): BridgeCrossingConsent {
  if (passportStatus === "VERIFIED") {
    return {
      disclosure: CROSSING_TRUST_DISCLOSURE,
      requiresAck: true,
    };
  }
  return {
    disclosure: CROSSING_UNVERIFIED_DISCLOSURE,
    requiresAck: false,
  };
}

export type BridgeDirectionMode = "move" | "return";

/**
 * Leave-home vs return-home from custody vs origin (`chainIdOf(tokenId)`).
 * Legacy / unknown origin (≤ 0) fails soft to move copy.
 */
export function deriveBridgeDirectionMode(input: {
  custodyChainId: number;
  originChainId: number;
}): BridgeDirectionMode {
  if (input.originChainId <= 0) return "move";
  return input.custodyChainId === input.originChainId ? "move" : "return";
}

export function bridgeActionCopy(
  mode: BridgeDirectionMode,
  dstName: string,
): { title: string; description: string; idleButton: string } {
  if (mode === "return") {
    return {
      title: "Bridge",
      description: `Return this passport to ${dstName} via LayerZero.`,
      idleButton: `Return to ${dstName}`,
    };
  }
  return {
    title: "Bridge",
    description: `Move this passport to ${dstName} via LayerZero.`,
    idleButton: `Move to ${dstName}`,
  };
}

/** Mono hop id line (design-spec §4.19). */
export function bridgeHopIdLine(srcChainId: number, dstChainId: number): string {
  return `${srcChainId} → ${dstChainId}`;
}

/**
 * After the first hop of a multi-hop route settles — operation stays open
 * (design-spec §4.19). Never frames arrival that has not happened.
 */
export const BRIDGE_SECOND_HOP_REQUIRED =
  "A second hop is required to finish this move.";

/**
 * Wallet VM mismatch for the next hop (design-spec §4.19 / §4.7).
 * Never a network-switch prompt.
 */
export function bridgeNextHopWrongVmCopy(input: {
  networkName: string;
  wantedFamily: "evm" | "svm";
}): string {
  const FAMILY_LABEL = { evm: "Ethereum", svm: "Solana" } as const;
  const family = FAMILY_LABEL[input.wantedFamily];
  return `The next hop is on ${input.networkName}. Connect a ${family} wallet to continue.`;
}
