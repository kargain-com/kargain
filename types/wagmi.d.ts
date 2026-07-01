import type { WagmiConfig } from "@/lib/web3/wagmi-config";

declare module "wagmi" {
  interface Register {
    config: WagmiConfig;
  }
}
