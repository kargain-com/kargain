// Base Sepolia (84532) — deployed June 2025
// KarProPass:             0x13167606ea83a213ab9e10255f09c5389e7910de
// KarPassport:            0xe3568875db58be8e0ba6f44bf2a1178bb6777c29
// MarketplaceEscrow impl: 0x96dc74bc1f2ecf8e2b474c2c97e13205ca924313
// MarketplaceEscrow proxy:0x816855Ab573AfE959eBd5a5dc3A263288d194864
// Deployer/upgradeAuthority: 0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77
// platformRecipient:      0xcfe194fea9727bD04dA8F78c2362680986e02dF1

const BASE_SEPOLIA_CHAIN_ID = 84532;

export function karPassportAddress(
  chainId?: number
): `0x${string}` | undefined {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    return "0xe3568875db58be8e0ba6f44bf2a1178bb6777c29";
  }
  return undefined;
}

export function marketplaceAddress(
  chainId?: number
): `0x${string}` | undefined {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    return "0x816855Ab573AfE959eBd5a5dc3A263288d194864";
  }
  return undefined;
}

export function karProPassAddress(
  chainId?: number
): `0x${string}` | undefined {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    return "0x13167606ea83a213ab9e10255f09c5389e7910de";
  }
  return undefined;
}

export function usdcAddress(
  chainId?: number
): `0x${string}` | undefined {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    return "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  }
  return undefined;
}

export function kargainTimelockAddress(
  chainId?: number
): `0x${string}` | undefined {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    return "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77";
  }
  return undefined;
}

export function chainlinkNativeUsdFeed(
  chainId?: number
): `0x${string}` | undefined {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    return "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1";
  }
  return undefined;
}

export function chainlinkEurUsdFeed(
  chainId?: number
): `0x${string}` | undefined {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    return "0xb49f677943BC038e9857d61E7d053CaA2C1734C1";
  }
  return undefined;
}
