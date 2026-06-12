/** Official or canonical bridge entry points for UX hints (no endorsement). */
export function bridgeHintUrl(chainId: number): string | null {
  const m: Record<number, string> = {
    84532: "https://bridge.base.org/deposit",
  };
  return m[chainId] ?? null;
}
