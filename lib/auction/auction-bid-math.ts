/**
 * Minimum next bid for AscendingConsignment.
 * Mirrors Solidity: first bid must be ≥ reserve; later bids
 * `highestBid + (highestBid * minIncrementBps) / 10_000` (floor division).
 */
export function minNextBid(
  highestBid: bigint,
  minIncrementBps: number | bigint,
  reserve: bigint,
): bigint {
  if (highestBid === 0n) return reserve;
  const bps = BigInt(minIncrementBps);
  return highestBid + (highestBid * bps) / 10_000n;
}
