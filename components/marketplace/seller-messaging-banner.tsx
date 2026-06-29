"use client";

import { MessagingSetupCard } from "@/components/messaging/messaging-setup-card";
import { useMessagingStatus } from "@/hooks/use-messaging-status";

export function SellerMessagingBanner() {
  const { needsSetup } = useMessagingStatus();

  if (!needsSetup) return null;

  return <MessagingSetupCard context="seller" variant="full" />;
}
