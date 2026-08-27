import {
  ETHEREUM_SEPOLIA_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
} from "@/lib/web3/sepolia-addresses";
import {
  bridgeGatewayAddress,
  karPassportAddress,
} from "@/lib/web3/deployment-addresses";

/** Star hub chain id (reference). */
export const BRIDGE_HUB_CHAIN_ID = SEPOLIA_CHAIN_ID;

/** Star spoke chain id (reference). */
export const BRIDGE_SPOKE_CHAIN_ID = ETHEREUM_SEPOLIA_CHAIN_ID;

/** LayerZero endpoint id per commercial chain. */
export const EID_BY_CHAIN: Readonly<Record<number, number>> = {
  [BRIDGE_HUB_CHAIN_ID]: 40245,
  [BRIDGE_SPOKE_CHAIN_ID]: 40161,
};

export const BRIDGE_DELIVERY_POLL_MS = 8_000;
export const BRIDGE_DELIVERY_TIMEOUT_MS = 10 * 60 * 1000;

const LZ_SCAN_TESTNET_TX = "https://testnet.layerzeroscan.com/tx";

export type BridgeRouteHop = {
  srcChainId: number;
  dstChainId: number;
};

export type BridgeRouteOk = {
  ok: true;
  hops: BridgeRouteHop[];
};

export type BridgeRouteRefusalReason =
  | "unknown_src"
  | "unknown_dst"
  | "same_chain";

export type BridgeRouteRefusal = {
  ok: false;
  reason: BridgeRouteRefusalReason;
};

export type BridgeRouteResult = BridgeRouteOk | BridgeRouteRefusal;

function isCommercialBridgeChain(chainId: number): boolean {
  return Object.prototype.hasOwnProperty.call(EID_BY_CHAIN, chainId);
}

function commercialSpokeChainIds(): number[] {
  return Object.keys(EID_BY_CHAIN)
    .map(Number)
    .filter((id) => id !== BRIDGE_HUB_CHAIN_ID)
    .sort((a, b) => a - b);
}

/**
 * Sole owner of hub/spoke hop sequences.
 * One hop hub↔spoke; two hops spoke↔spoke via the hub (unreachable among
 * current commercial stacks). Missing network is a named refusal — never a
 * silent hub default.
 */
export function resolveBridgeRoute(
  src: number,
  dst: number,
): BridgeRouteResult {
  if (src === dst) {
    return { ok: false, reason: "same_chain" };
  }
  if (!isCommercialBridgeChain(src)) {
    return { ok: false, reason: "unknown_src" };
  }
  if (!isCommercialBridgeChain(dst)) {
    return { ok: false, reason: "unknown_dst" };
  }
  const srcIsHub = src === BRIDGE_HUB_CHAIN_ID;
  const dstIsHub = dst === BRIDGE_HUB_CHAIN_ID;
  if (srcIsHub !== dstIsHub) {
    return { ok: true, hops: [{ srcChainId: src, dstChainId: dst }] };
  }
  return {
    ok: true,
    hops: [
      { srcChainId: src, dstChainId: BRIDGE_HUB_CHAIN_ID },
      { srcChainId: BRIDGE_HUB_CHAIN_ID, dstChainId: dst },
    ],
  };
}

export function bridgeAdapterAddress(
  chainId: number,
): `0x${string}` | undefined {
  return bridgeGatewayAddress(chainId);
}

/**
 * Star counterpart chain for `src` (hub↔spoke).
 * Hub counterpart is unique while there is one commercial spoke.
 */
export function bridgeCounterpartChainId(src: number): number | undefined {
  if (!isCommercialBridgeChain(src)) return undefined;
  const dst =
    src === BRIDGE_HUB_CHAIN_ID
      ? (commercialSpokeChainIds()[0] ?? BRIDGE_SPOKE_CHAIN_ID)
      : BRIDGE_HUB_CHAIN_ID;
  const route = resolveBridgeRoute(src, dst);
  return route.ok ? dst : undefined;
}

/**
 * Destination LayerZero EID for a send from `srcChainId`
 * (EID of the star counterpart).
 */
export function bridgeDstEid(srcChainId: number): number | undefined {
  const dst = bridgeCounterpartChainId(srcChainId);
  if (dst == null) return undefined;
  return EID_BY_CHAIN[dst];
}

/** KarPassport ERC721 on `chainId` (ownerOf delivery poll target). */
export function bridgeTokenAddress(
  chainId: number,
): `0x${string}` | undefined {
  return karPassportAddress(chainId);
}

/** LayerZero Scan testnet deep link for an ONFTSent GUID. */
export function layerZeroScanTxUrl(guid: `0x${string}`): string {
  return `${LZ_SCAN_TESTNET_TX}/${guid}`;
}
