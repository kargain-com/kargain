"use client";

import { MessagingSetupCard } from "@/components/messaging/messaging-setup-card";
import { useMessagingSession } from "@/hooks/use-messaging-session";
import { needsMessagingSetupCard } from "@/lib/messaging/snapshot-ui";

export function SellerMessagingBanner() {
  const { snapshot } = useMessagingSession();
  const needsMessagingCard = needsMessagingSetupCard(snapshot);

  if (!needsMessagingCard) return null;

  return <MessagingSetupCard context="seller" variant="full" />;
}
