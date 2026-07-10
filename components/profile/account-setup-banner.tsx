"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useMessagingStatus } from "@/hooks/use-messaging-status";

export function AccountSetupBanner() {
  const { needsSetup, needsDeviceRestore } = useMessagingStatus();
  const needsMessagingCard = needsSetup || needsDeviceRestore;

  if (!needsMessagingCard) return null;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-default bg-bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-text-secondary">
        Finish account setup — enable messages so buyers and verifiers can reach you.
      </p>
      <Button variant="secondary" size="sm" className="shrink-0" asChild>
        <Link href="/profile/edit#messages">Enable messages</Link>
      </Button>
    </div>
  );
}
