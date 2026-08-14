import { mainnet } from "viem/chains";
import { createConfig, http, type Config, type CreateConnectorFn } from "wagmi";
import { injected } from "wagmi/connectors";

import { appUrl } from "@/lib/config/app-url";
import { kargainChains, rpcUrlForChain } from "@/lib/web3/supported-chains";
import { walletConnectProjectId } from "@/lib/web3/wallet-connect";

const wagmiChains = [...kargainChains, mainnet] as const;

const transports = {
  ...Object.fromEntries(
    kargainChains.map((c) => [c.id, http(rpcUrlForChain(c.id))]),
  ),
  [mainnet.id]: http(process.env.NEXT_PUBLIC_RPC_1 ?? "https://ethereum.publicnode.com"),
} as Record<(typeof wagmiChains)[number]["id"], ReturnType<typeof http>>;

function buildInjectedConnector(): CreateConnectorFn {
  return injected({ shimDisconnect: true });
}

/** Wagmi config: injected only at boot — WalletConnect registered on connect attempt. */
export function createWagmiConfig() {
  return createConfig({
    chains: wagmiChains,
    connectors: [buildInjectedConnector()],
    transports,
    ssr: true,
  });
}

export type WagmiConfig = ReturnType<typeof createWagmiConfig>;

let walletConnectEnsure: Promise<void> | null = null;

/**
 * Dynamically import and register WalletConnect once (wagmi `_internal.connectors.setup`).
 * Call from WalletLoginButton before showing connect options — not from AppProviders mount.
 */
export function ensureWalletConnectConnector(config: Config): Promise<void> {
  if (!walletConnectProjectId()) return Promise.resolve();
  if (config.connectors.some((c) => c.id === "walletConnect")) {
    return Promise.resolve();
  }
  if (walletConnectEnsure) return walletConnectEnsure;

  walletConnectEnsure = (async () => {
    if (config.connectors.some((c) => c.id === "walletConnect")) return;
    const { walletConnect } = await import("wagmi/connectors");
    const origin = appUrl();
    const projectId = walletConnectProjectId();
    if (!projectId) return;
    const connectorFn = walletConnect({
      projectId,
      showQrModal: true,
      metadata: {
        name: "Kargain",
        description: "Vehicle passports and marketplace",
        url: origin,
        icons: [`${origin}/kargain-logo.svg`],
      },
    });
    config._internal.connectors.setup(connectorFn);
  })().catch((err) => {
    walletConnectEnsure = null;
    throw err;
  });

  return walletConnectEnsure;
}
