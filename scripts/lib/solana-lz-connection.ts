/**
 * Dual @solana/web3.js package versions (root ^1.98 vs nested 1.95 inside
 * @layerzerolabs/lz-solana-sdk-v2) share one runtime Connection shape but
 * TypeScript treats private fields as incompatible. This owner erases the
 * nominal mismatch at the LZ SDK call boundary — not a pnpm override.
 */
export function asLzSdkConnection<TExpected>(
  connection: import("@solana/web3.js").Connection,
): TExpected {
  return connection as unknown as TExpected;
}
