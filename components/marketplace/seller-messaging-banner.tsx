"use client";

import Link from "next/link";

import { MessagingSetupCard } from "@/components/messaging/messaging-setup-card";
import { Button } from "@/components/ui/button";
import { useMessagingSession } from "@/hooks/use-messaging-session";
import {
  needsMessagingSetupCard,
  needsSellerUnreachableDisclosure,
  primaryActionFromSnapshot,
} from "@/lib/messaging/snapshot-ui";

/**
 * Own-listing messaging surface: setup when incomplete; factual disclosure when
 * active but not publicly reachable. Never gates commerce controls.
 */
export function SellerMessagingBanner() {
  const { snapshot, dispatch } = useMessagingSession();
  const needsMessagingCard = needsMessagingSetupCard(snapshot);
  const needsDisclosure = needsSellerUnreachableDisclosure(snapshot);

  if (needsMessagingCard) {
    return <MessagingSetupCard context="seller" variant="full" />;
  }

  if (!needsDisclosure) return null;

  const primary = primaryActionFromSnapshot(snapshot);

  return (
    <div
      className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4"
      role="status"
    >
      <p className="text-sm text-text-secondary">
        Buyers cannot send you encrypted messages while private messages are off or not published
        for your account.
      </p>
      {primary ? (
        <Button
          type="button"
          size="sm"
          onClick={() => dispatch(primary.command)}
        >
          {primary.label}
        </Button>
      ) : (
        <Button type="button" size="sm" variant="secondary" asChild>
          <Link href="/profile/edit#messages">Open message settings</Link>
        </Button>
      )}
    </div>
  );
}
