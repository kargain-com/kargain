import type { PassportStatus } from "@/lib/types/ponder";
import { bridgeCounterpartChainId } from "@/lib/web3/bridge";

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
  listingState: BridgeListingState;
  /** `undefined` means auction truth is unresolved — fail closed. */
  auctionBlocks: boolean | undefined;
  passportStatus: PassportStatus;
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
export function deriveBridgeSurface(
  input: BridgeSurfaceInput,
): BridgeSurfaceResult {
  if (!input.isOwner) {
    return { ...HIDDEN };
  }

  if (bridgeCounterpartChainId(input.chainId) == null) {
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

  // Trust state first: DISPUTED surfaces over listed/auction when both apply.
  if (input.passportStatus === "DISPUTED") {
    return {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: "disputed",
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
