"use client";

import { MessagingSetupCard } from "@/components/messaging/messaging-setup-card";
import { useMessagingStatus } from "@/hooks/use-messaging-status";

export function SellerMessagingBanner() {
  const { needsSetup, needsDeviceRestore } = useMessagingStatus();
  const needsMessagingCard = needsSetup || needsDeviceRestore;

  if (!needsMessagingCard) return null;

  return <MessagingSetupCard context="seller" variant="full" />;
}
