/** Mirrors FixedPriceConsignment seller-net floor check — raw 1e8 arithmetic, no FX conversion. */

export const MAX_AGENT_FEE_BPS = 3000;

export type SellerNetBreakdown = {
  agentFee: bigint;
  platformFee: bigint;
  sellerNet: bigint;
};

export function computeSellerNet(
  price1e8: bigint,
  agentFeeBps: number,
  platformFeeBps: bigint,
): SellerNetBreakdown {
  const agentFee = (price1e8 * BigInt(agentFeeBps)) / 10_000n;
  const platformFee = (price1e8 * platformFeeBps) / 10_000n;
  const sellerNet = price1e8 - agentFee - platformFee;
  return { agentFee, platformFee, sellerNet };
}

export function satisfiesOwnerMin(
  sellerNet: bigint,
  ownerMinPrice1e8: bigint,
): boolean {
  return sellerNet >= ownerMinPrice1e8;
}

export function sellerNetSatisfied(
  price1e8: bigint | null,
  agentFeeBps: number,
  platformFeeBps: bigint | null | undefined,
  ownerMinPrice1e8: bigint,
): boolean {
  if (price1e8 == null || price1e8 <= 0n) return false;
  if (platformFeeBps == null) return false;
  if (agentFeeBps < 0 || agentFeeBps > MAX_AGENT_FEE_BPS) return false;
  const { sellerNet } = computeSellerNet(price1e8, agentFeeBps, platformFeeBps);
  return satisfiesOwnerMin(sellerNet, ownerMinPrice1e8);
}
