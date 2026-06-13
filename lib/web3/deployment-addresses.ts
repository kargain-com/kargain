// Base Sepolia (84532) — Model X, redeployed June 2026
// KarProPass:              0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1
// KarProStaking:           0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31
// KarPassport:             0xCfA1eAB89D6D1DE1244CF346D5a4F1E7343E9083
// MarketplaceEscrow impl:  0x8888594b12DF2e1EF406e91CFF72d52801BCaC24
// MarketplaceEscrow proxy: 0xcD40C83CD57422C616e7e63F562B2e78C269Fb7F
// Deployer/upgradeAuthority: 0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77
// platformRecipient:       0xcfe194fea9727bD04dA8F78c2362680986e02dF1

const BASE_SEPOLIA_CHAIN_ID = 84532;

export function karPassportAddress(
  chainId?: number
): `0x${string}` | undefined {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    return "0xCfA1eAB89D6D1DE1244CF346D5a4F1E7343E9083";
  }
  return undefined;
}

export function marketplaceAddress(
  chainId?: number
): `0x${string}` | undefined {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    return "0xcD40C83CD57422C616e7e63F562B2e78C269Fb7F";
  }
  return undefined;
}

export function karProPassAddress(
  chainId?: number
): `0x${string}` | undefined {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    return "0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1";
  }
  return undefined;
}

export function karProStakingAddress(
  chainId?: number
): `0x${string}` | undefined {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    return "0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31";
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
