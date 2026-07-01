import { mainnet } from "viem/chains";
import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";

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

function buildConnectors() {
  const projectId = walletConnectProjectId();
  const origin = appUrl();

  return [
    ...(projectId
      ? [
          walletConnect({
            projectId,
            showQrModal: true,
            metadata: {
              name: "Kargain",
              description: "Vehicle passports and marketplace",
              url: origin,
              icons: [`${origin}/kargain-logo.svg`],
            },
          }),
        ]
      : []),
    injected({ shimDisconnect: true }),
  ];
}

/** Wagmi config: WalletConnect (when project ID set) + injected browser wallet. */
export function createWagmiConfig() {
  return createConfig({
    chains: wagmiChains,
    connectors: buildConnectors(),
    transports,
    ssr: true,
  });
}

export type WagmiConfig = ReturnType<typeof createWagmiConfig>;
