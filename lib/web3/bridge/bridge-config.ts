import {
  ETHEREUM_SEPOLIA_CHAIN_ID,
  ETHEREUM_SEPOLIA_SPOKE,
  SEPOLIA_CHAIN_ID,
} from "@/lib/web3/sepolia-addresses";
import { bridgeGatewayAddress } from "@/lib/web3/deployment-addresses";

/** Hub chain for bridge writes (wagmi). */
export const BRIDGE_HUB_CHAIN_ID = SEPOLIA_CHAIN_ID;

/** Spoke chain — app read-only (ownerOf delivery polls). */
export const BRIDGE_SPOKE_CHAIN_ID = ETHEREUM_SEPOLIA_CHAIN_ID;

/** LayerZero destination EID keyed by source chain id. */
export const BRIDGE_DST_EID_BY_SRC_CHAIN: Readonly<Record<number, number>> = {
  [BRIDGE_HUB_CHAIN_ID]: ETHEREUM_SEPOLIA_SPOKE.spokeEid,
};

export const BRIDGE_DELIVERY_POLL_MS = 8_000;
export const BRIDGE_DELIVERY_TIMEOUT_MS = 10 * 60 * 1000;

const LZ_SCAN_TESTNET_TX = "https://testnet.layerzeroscan.com/tx";

export function bridgeAdapterAddress(
  chainId: number = BRIDGE_HUB_CHAIN_ID,
): `0x${string}` | undefined {
  return bridgeGatewayAddress(chainId);
}

export function bridgeSpokeOnftAddress(): `0x${string}` {
  return ETHEREUM_SEPOLIA_SPOKE.karPassportOnft;
}

export function bridgeDstEid(srcChainId: number): number | undefined {
  return BRIDGE_DST_EID_BY_SRC_CHAIN[srcChainId];
}

/** LayerZero Scan testnet deep link for an ONFTSent GUID. */
export function layerZeroScanTxUrl(guid: `0x${string}`): string {
  return `${LZ_SCAN_TESTNET_TX}/${guid}`;
}
