import type { CommerceMode } from "@/lib/commerce/mode";
import { bridgeCounterpartChainId } from "@/lib/web3/bridge";

export type BridgeBlockReason =
  | "consigned"
  | "challenged"
  | "refused"
  | "unresolved";

export type BridgeSurfaceMode = "hidden" | "action";

export type BridgeSurfaceResult = {
  visible: boolean;
  mode: BridgeSurfaceMode;
  canBridge: boolean;
  blockReason: BridgeBlockReason | null;
};

export type BridgeSurfaceInput = {
  isOwner: boolean;
  /** Custody chain — where the token lives now. */
  chainId: number;
  /**
   * `may(tokenId, LeaveChain)` from KarPassport — the authoritative gate.
   * `undefined` means unresolved: fail closed.
   */
  mayLeaveChain: boolean | undefined;
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

  if (input.mayLeaveChain === undefined) {
    return {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: "unresolved",
    };
  }

  if (input.mayLeaveChain === false) {
    // Challenge first: it outranks commerce when both apply.
    const reason: BridgeBlockReason = input.challengeOpen
      ? "challenged"
      : input.liveConsignmentMode
        ? "consigned"
        : "refused";
    return { visible: true, mode: "action", canBridge: false, blockReason: reason };
  }

  if (input.transitActive) {
    return { ...TRANSIT_VISIBLE };
  }

  return {
    visible: true,
    mode: "action",
    canBridge: true,
    blockReason: null,
  };
}

export function bridgeBlockReasonCopy(
  reason: BridgeBlockReason,
): string {
  switch (reason) {
    case "consigned":
      return "Close the open consignment before bridging.";
    case "challenged":
      return "Resolve the open challenge before bridging.";
    case "refused":
      return "This passport cannot leave the chain right now.";
    case "unresolved":
      return "Waiting for chain permission…";
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
