"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, Suspense, useEffect, useState } from "react";

import { WalletSessionSync } from "@/components/providers/wallet-session-sync";
import { MessagingNotificationsGate } from "@/components/providers/messaging-notifications-gate";
import { NostrKeyProvider } from "@/hooks/use-nostr-key";
import { DisplayCurrencyProvider } from "@/lib/marketplace/display-currency-context";
import { createWagmiConfig } from "@/lib/web3/wagmi-config";

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
      <WagmiProvider config={wagmiConfig}>
        <DisplayCurrencyProvider>
          <WalletSessionSync />
          <NostrKeyProvider>
            <Suspense fallback={children}>
              <MessagingNotificationsGate>{children}</MessagingNotificationsGate>
            </Suspense>
          </NostrKeyProvider>
        </DisplayCurrencyProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}
