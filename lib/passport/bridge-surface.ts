import type { PassportStatus } from "@/lib/types/ponder";
import { SEPOLIA_CHAIN_ID } from "@/lib/web3/sepolia-addresses";

export type BridgeListingState =
  | "pending"
  | "failure"
  | "active"
  | "inactive";

export type BridgeBlockReason =
  | "listed"
  | "auction"
  | "disputed"
  | "unresolved";

export type BridgeSurfaceMode = "hidden" | "action" | "spoke_info";

export type BridgeSurfaceResult = {
  visible: boolean;
  mode: BridgeSurfaceMode;
  canBridge: boolean;
  blockReason: BridgeBlockReason | null;
};

export type BridgeSurfaceInput = {
  isOwner: boolean;
  chainId: number;
  listingState: BridgeListingState;
  /** `undefined` means auction truth is unresolved — fail closed. */
  auctionBlocks: boolean | undefined;
  passportStatus: PassportStatus;
  onSpokeChain: boolean;
};

const HIDDEN: BridgeSurfaceResult = {
  visible: false,
  mode: "hidden",
  canBridge: false,
  blockReason: null,
};

/**
 * Pure owner bridge-surface policy. Unknown listing/auction facts fail closed.
 * Spoke view is informational only (return to hub to bridge).
 */
export function deriveBridgeSurface(
  input: BridgeSurfaceInput,
): BridgeSurfaceResult {
  if (!input.isOwner) {
    return { ...HIDDEN };
  }

  if (input.onSpokeChain) {
    return {
      visible: true,
      mode: "spoke_info",
      canBridge: false,
      blockReason: null,
    };
  }

  if (input.chainId !== SEPOLIA_CHAIN_ID) {
    return { ...HIDDEN };
  }

  if (
    input.listingState === "pending" ||
    input.listingState === "failure" ||
    input.auctionBlocks === undefined
  ) {
    return {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: "unresolved",
    };
  }

  if (input.listingState === "active") {
    return {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: "listed",
    };
  }

  if (input.auctionBlocks === true) {
    return {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: "auction",
    };
  }

  if (input.passportStatus === "DISPUTED") {
    return {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: "disputed",
    };
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
    case "listed":
      return "Delist this vehicle before bridging.";
    case "auction":
      return "Finish or cancel the auction before bridging.";
    case "disputed":
      return "Resolve the dispute before bridging.";
    case "unresolved":
      return "Waiting for listing and auction status…";
  }
}
