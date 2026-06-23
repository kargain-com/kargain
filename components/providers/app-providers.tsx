"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";

import { NostrKeyInitializer } from "@/components/providers/nostr-key-initializer";
import { NotificationsProvider } from "@/hooks/use-notification-state";
import { DisplayCurrencyProvider } from "@/lib/marketplace/display-currency-context";
import { createStandaloneWagmiConfig } from "@/lib/web3/wagmi-standalone-config";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [standaloneWagmiConfig] = useState(() => createStandaloneWagmiConfig());

  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg =
        reason && typeof reason === "object" && "message" in reason
          ? String((reason as Error).message)
          : String(reason);
      // Some wallet/auth libraries throw unhandled rejections; prevent noisy dev UX.
      if (msg.includes("has not been authorized yet")) {
        event.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={standaloneWagmiConfig as never}>
        <DisplayCurrencyProvider>
          <NostrKeyInitializer />
          <NotificationsProvider>{children}</NotificationsProvider>
        </DisplayCurrencyProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}
