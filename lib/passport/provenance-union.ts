export type ProvenanceRecord = {
  id: string;
  tokenId: string;
  chainId: number;
  timestamp: bigint;
};

/**
 * UNION of chain-sharded records by global tokenId, sorted by timestamp then id.
 */
export function unionRecordsByTokenId<T extends ProvenanceRecord>(
  rows: readonly T[],
  tokenId: string,
): T[] {
  return rows
    .filter((row) => row.tokenId === tokenId)
    .slice()
    .sort((a, b) => {
      if (a.timestamp === b.timestamp) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      return a.timestamp < b.timestamp ? -1 : 1;
    });
}
