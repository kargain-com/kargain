/** WalletConnect Cloud project ID from env (required for mobile browser connect). */
export function walletConnectProjectId(): string | undefined {
  const id = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  return id || undefined;
}

/** True when an EIP-1193 provider is injected (extension or wallet in-app browser). */
export function hasInjectedEthereumProvider(): boolean {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

/** Mobile phone/tablet browser (not desktop). */
export function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
