import type { wagmiConfig } from "@/lib/web3/wagmi-config";

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
