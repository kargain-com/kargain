/** Immutable origin namespace — `tokenId >> 128` (SPEC §I.12.1). */
export function originNamespaceOf(tokenId: bigint | string): number {
  const id = typeof tokenId === "bigint" ? tokenId : BigInt(tokenId);
  return Number(id >> 128n);
}
