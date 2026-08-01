import type { CommerceMode } from "@/lib/commerce/mode";
import {
  encumbrancePermissionCopy,
  isEncumbrancePermissionAvailable,
  type EncumbrancePermissionGate,
} from "@/lib/passport/encumbrance-permission";
import { bridgeCounterpartChainId } from "@/lib/web3/bridge";
import type { Address } from "viem";

export type BridgeBlockReason =
  | "consigned"
  | "challenged"
  | "refused"
  | "unresolved"
  | "source_unanswerable";

export type BridgeSurfaceMode = "hidden" | "action";

export type BridgeSurfaceResult = {
  visible: boolean;
  mode: BridgeSurfaceMode;
  canBridge: boolean;
  blockReason: BridgeBlockReason | null;
  /** Set when `blockReason` is `source_unanswerable`. */
  unanswerableSource: Address | null;
};

export type BridgeSurfaceInput = {
  isOwner: boolean;
  /** Custody chain — where the token lives now. */
  chainId: number;
  /**
   * `may(tokenId, LeaveChain)` gate — the authoritative leave permission.
   */
  leaveChainPermission: EncumbrancePermissionGate;
  /** Live consignment mode, when known, so the block copy can be specific. */
  liveConsignmentMode?: CommerceMode | null;
  /** Open passport challenge (bonded verification challenge). */
  challengeOpen?: boolean;
  /**
   * Active bridge transit for this token (src burn/lock — wallet may no longer
   * own the NFT). Keeps the panel visible with canBridge false.
   */
  transitActive?: boolean;
};

const HIDDEN: BridgeSurfaceResult = {
  visible: false,
  mode: "hidden",
  canBridge: false,
  blockReason: null,
  unanswerableSource: null,
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
};

export function deriveBridgeSurface(
  input: BridgeSurfaceInput,
): BridgeSurfaceResult {
  if (!input.isOwner) {
    // In-flight: NFT may be burned/locked — keep transit chrome visible.
    if (input.transitActive) {
      return { ...TRANSIT_VISIBLE };
    }
    return { ...HIDDEN };
  }

  if (bridgeCounterpartChainId(input.chainId) == null) {
    if (input.transitActive) {
      return { ...TRANSIT_VISIBLE };
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
    };
  }

  if (gate.status === "blocked" && gate.cause === "source_unanswerable") {
    return {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: "source_unanswerable",
      unanswerableSource: gate.source,
    };
  }

  if (gate.status === "blocked" && gate.cause === "refused") {
    // Challenge first: it outranks commerce when both apply.
    const reason: BridgeBlockReason = input.challengeOpen
      ? "challenged"
      : input.liveConsignmentMode
        ? "consigned"
        : "refused";
    return {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: reason,
      unanswerableSource: null,
    };
  }

  if (input.transitActive) {
    return { ...TRANSIT_VISIBLE };
  }

  if (!isEncumbrancePermissionAvailable(gate)) {
    return {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: "unresolved",
      unanswerableSource: null,
    };
  }

  return {
    visible: true,
    mode: "action",
    canBridge: true,
    blockReason: null,
    unanswerableSource: null,
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
  }
}

/**
 * Term of a crossing (X2) — shown before send on Move and Return.
 * Plain disclosure, not an alarm.
 */
export const CROSSING_TRUST_DISCLOSURE =
  "Verification does not travel. After you send, the passport begins unverified on the destination chain. Returning home clears verification on this chain too — a verification is a statement by a professional whose stake lives on one chain.";

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
