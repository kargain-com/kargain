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

const COUNTERPART: Readonly<Record<number, number>> = {
  [BRIDGE_HUB_CHAIN_ID]: BRIDGE_SPOKE_CHAIN_ID,
  [BRIDGE_SPOKE_CHAIN_ID]: BRIDGE_HUB_CHAIN_ID,
};

export const BRIDGE_DELIVERY_POLL_MS = 8_000;
export const BRIDGE_DELIVERY_TIMEOUT_MS = 10 * 60 * 1000;

const LZ_SCAN_TESTNET_TX = "https://testnet.layerzeroscan.com/tx";

export function bridgeAdapterAddress(
  chainId: number = BRIDGE_HUB_CHAIN_ID,
): `0x${string}` | undefined {
  return bridgeGatewayAddress(chainId);
}

/** Star counterpart chain for `src` (hub↔spoke). */
export function bridgeCounterpartChainId(src: number): number | undefined {
  return COUNTERPART[src];
}

/**
 * Destination LayerZero EID for a send from `srcChainId`
 * (EID of the star counterpart).
 */
export function bridgeDstEid(srcChainId: number): number | undefined {
  const dst = COUNTERPART[srcChainId];
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
