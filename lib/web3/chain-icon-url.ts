/**
 * Chain logo URLs (Trust Wallet asset repo, raw). Used only for UI.
 */
const TRUST = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";

const byId: Record<number, string> = {
  84532: `${TRUST}/base/info/logo.png`,
};

export function chainIconUrl(chainId: number): string | undefined {
  return byId[chainId];
}
