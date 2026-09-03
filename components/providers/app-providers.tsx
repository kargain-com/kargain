"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";

import { WalletSessionSync } from "@/components/providers/wallet-session-sync";
import { DisplayCurrencyProvider } from "@/lib/marketplace/display-currency-context";
import { SvmAccountSessionProvider } from "@/lib/web3/svm-account-session";
import { createWagmiConfig } from "@/lib/web3/wagmi-config";

/**
 * Global providers only (Query / Wagmi / SVM session / DisplayCurrency / WalletSessionSync).
 * Nostr + messaging mount solely under `app/(identity)/layout.tsx`.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [wagmiConfig] = useState(() => createWagmiConfig());

  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg =
        reason && typeof reason === "object" && "message" in reason
          ? String((reason as Error).message)
          : String(reason);
      if (msg.includes("has not been authorized yet")) {
        event.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <SvmAccountSessionProvider>
          <DisplayCurrencyProvider>
            <WalletSessionSync />
            {children}
          </DisplayCurrencyProvider>
        </SvmAccountSessionProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}
