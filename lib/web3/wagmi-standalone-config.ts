import { mainnet } from "viem/chains";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

import { kargainChains, rpcUrlForChain } from "@/lib/web3/supported-chains";

const wagmiChains = [...kargainChains, mainnet] as const;

const transports = {
  ...Object.fromEntries(
    kargainChains.map((c) => [c.id, http(rpcUrlForChain(c.id))]),
  ),
  [mainnet.id]: http(process.env.NEXT_PUBLIC_RPC_1 ?? "https://ethereum.publicnode.com"),
} as Record<(typeof wagmiChains)[number]["id"], ReturnType<typeof http>>;

/** Wagmi config for CI / local dev with injected wallet only. */
export function createStandaloneWagmiConfig() {
  return createConfig({
    chains: wagmiChains,
    connectors: [injected()],
    transports,
    ssr: true,
  });
}
