import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

import { kargainChains, rpcUrlForChain } from "@/lib/web3/supported-chains";

const transports = Object.fromEntries(
  kargainChains.map((c) => [c.id, http(rpcUrlForChain(c.id))]),
) as Record<(typeof kargainChains)[number]["id"], ReturnType<typeof http>>;

/** Wagmi config for CI / local dev with injected wallet only. */
export function createStandaloneWagmiConfig() {
  return createConfig({
    chains: kargainChains,
    connectors: [injected()],
    transports,
    ssr: true,
  });
}
