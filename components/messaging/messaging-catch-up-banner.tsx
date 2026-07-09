"use client";

import { CloseIcon } from "@/components/ui/icons";

import { useXmtpConversationsContext } from "@/components/providers/xmtp-conversations-provider";
import { useMessagingStatus } from "@/hooks/use-messaging-status";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
};

export function MessagingCatchUpBanner({ className }: Props) {
  const { isReady } = useMessagingStatus();
  const { unreadTotal, catchUpNewCount, dismissCatchUp } = useXmtpConversationsContext();

  if (!isReady || catchUpNewCount <= 0 || unreadTotal <= 0) {
    return null;
  }

  const label =
    catchUpNewCount === unreadTotal
      ? `You have ${unreadTotal} unread message${unreadTotal === 1 ? "" : "s"}`
      : `${catchUpNewCount} new message${catchUpNewCount === 1 ? "" : "s"} since you were away`;

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 rounded-md border border-border-default bg-bg-card p-4",
        className,
      )}
      role="status"
    >
      <p className="text-sm text-text-primary">{label}</p>
      <button
        type="button"
        className="shrink-0 rounded-sm p-1 text-text-secondary transition-colors duration-150 hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        onClick={dismissCatchUp}
        aria-label="Dismiss"
      >
        <CloseIcon size={16} className="size-4" aria-hidden />
      </button>
    </div>
  );
}
