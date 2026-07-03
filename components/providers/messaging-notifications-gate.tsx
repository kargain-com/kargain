"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import { useAccount } from "wagmi";

import { routeNeedsMessagingNotificationsProviders } from "@/lib/messaging/messaging-notifications-routes";

const MessagingNotificationsProviders = dynamic(
  () =>
    import("@/components/providers/messaging-notifications-providers").then(
      (module) => module.MessagingNotificationsProviders,
    ),
  { ssr: false },
);

export function MessagingNotificationsGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isConnected } = useAccount();
  const shouldMount = isConnected || routeNeedsMessagingNotificationsProviders(pathname);

  if (!shouldMount) {
    return <>{children}</>;
  }

  return <MessagingNotificationsProviders>{children}</MessagingNotificationsProviders>;
}
