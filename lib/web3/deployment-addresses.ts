// Base Sepolia (84532) — Model X, deployed June 2026
// KarProPass:              0x7d2E1BAa3Cb92F5647005A666389150aF9875eA1
// KarProStaking:           0xA67aF973385E82f690e2a5170e42A620Bc82b5EE
// KarPassport:             0x76b66eA782429f796a16671578fa5E9f941EeB6a
// MarketplaceEscrow impl:  0x39f62fD73eB8b50A3Ea1E2503fe672e119ab8664
// MarketplaceEscrow proxy: 0xc6C050ada9F744419495E92F603bC50062Bab6e6
// Deployer/upgradeAuthority: 0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77
// platformRecipient:       0xcfe194fea9727bD04dA8F78c2362680986e02dF1

const BASE_SEPOLIA_CHAIN_ID = 84532;

export function karPassportAddress(
  chainId?: number
): `0x${string}` | undefined {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    return "0x76b66eA782429f796a16671578fa5E9f941EeB6a";
  }
  return undefined;
}

export function marketplaceAddress(
  chainId?: number
): `0x${string}` | undefined {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    return "0xc6C050ada9F744419495E92F603bC50062Bab6e6";
  }
  return undefined;
}

export function karProPassAddress(
  chainId?: number
): `0x${string}` | undefined {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    return "0x7d2E1BAa3Cb92F5647005A666389150aF9875eA1";
  }
  return undefined;
}

export function karProStakingAddress(
  chainId?: number
): `0x${string}` | undefined {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    return "0xA67aF973385E82f690e2a5170e42A620Bc82b5EE";
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
