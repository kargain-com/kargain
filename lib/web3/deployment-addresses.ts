/**
 * Sole door per EVM address fact. `COMMERCIAL_ACTIVE` is the only runtime
 * source — no environment overlay. Every door takes a branded
 * {@link Eip155ChainId} (mint via `resolveEvmChain` / `evmChainOf`), so a
 * network without a registry row cannot reach a door.
 *
 * Commerce-mode addresses are owned by `lib/commerce/mode.ts`; the protocol-
 * address enumeration is owned by `evmProtocolAddresses` in the registry.
 */

import {
  requireEvmCommercialActive,
  type Eip155ChainId,
} from "./commercial-active";

export function karPassportAddress(chainId: Eip155ChainId): `0x${string}` {
  return requireEvmCommercialActive(chainId).karPassport;
}

export function karProPassAddress(chainId: Eip155ChainId): `0x${string}` {
  return requireEvmCommercialActive(chainId).karProPass;
}

export function karProStakingAddress(chainId: Eip155ChainId): `0x${string}` {
  return requireEvmCommercialActive(chainId).karProStaking;
}

export function usdcAddress(chainId: Eip155ChainId): `0x${string}` {
  return requireEvmCommercialActive(chainId).usdc;
}

export function kargainTimelockAddress(chainId: Eip155ChainId): `0x${string}` {
  return requireEvmCommercialActive(chainId).timelock;
}

export function bridgeGatewayAddress(chainId: Eip155ChainId): `0x${string}` {
  return requireEvmCommercialActive(chainId).bridgeGateway;
}

export function chainlinkNativeUsdFeed(chainId: Eip155ChainId): `0x${string}` {
  return requireEvmCommercialActive(chainId).nativeFeed;
}

export type ChainlinkEurUsdFeedResult =
  | { ok: true; address: `0x${string}` }
  | { ok: false; cause: "not_configured" };

/** EUR/USD feed is optional on a stack — absence is a named cause, not `undefined`. */
export function chainlinkEurUsdFeed(
  chainId: Eip155ChainId,
): ChainlinkEurUsdFeedResult {
  const address = requireEvmCommercialActive(chainId).eurFeed;
  return address == null
    ? { ok: false, cause: "not_configured" }
    : { ok: true, address };
}
