import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

/** Irys devnet / testnet uploads are served from the Irys gateway, not arweave.net. */
export const IRYS_DEVNET_GATEWAY = "https://gateway.irys.xyz";

export const ARWEAVE_MAINNET_GATEWAY = "https://arweave.net";

const MAINNET_CHAIN_IDS = new Set([1, 8453]);

export function isArweaveMainnetChain(chainId: number): boolean {
  return MAINNET_CHAIN_IDS.has(chainId);
}

/** HTTP gateway for `ar://` ids — override with ARWEAVE_GATEWAY / NEXT_PUBLIC_ARWEAVE_GATEWAY. */
export function arweaveGateway(chainId: number = DEFAULT_CHAIN_ID): string {
  const override =
    process.env.NEXT_PUBLIC_ARWEAVE_GATEWAY?.trim() ??
    process.env.ARWEAVE_GATEWAY?.trim();
  if (override) return override.replace(/\/$/, "");
  return isArweaveMainnetChain(chainId) ? ARWEAVE_MAINNET_GATEWAY : IRYS_DEVNET_GATEWAY;
}

export function arUriToHttp(uri: string, chainId: number = DEFAULT_CHAIN_ID): string | null {
  const u = uri.trim();
  if (!u.startsWith("ar://")) return null;
  return `${arweaveGateway(chainId)}/${u.slice("ar://".length)}`;
}
