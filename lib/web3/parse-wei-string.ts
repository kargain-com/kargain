/** Parse a wire-format wei amount (string, number, or bigint) to bigint. */
export function parseWeiString(
  value: string | number | bigint | undefined | null,
): bigint {
  if (value == null || value === "") return 0n;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}
