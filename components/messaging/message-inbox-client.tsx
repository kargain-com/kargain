"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useAccount } from "wagmi";

import { Button } from "@/components/ui/button";
import { useXmtpClient } from "@/hooks/use-xmtp-client";
import { useXmtpConversations } from "@/hooks/use-xmtp-conversations";
import { formatRelativeTime, getClientEthereumAddress, shortAddress } from "@/lib/xmtp/helpers";

function InboxSkeleton() {
  return (
    <ul className="space-y-2" aria-hidden>
      {Array.from({ length: 4 }).map((_, index) => (
        <li key={index} className="animate-pulse rounded-md border border-border-default bg-bg-surface p-4">
          <div className="h-3 w-24 rounded bg-bg-surface" />
          <div className="mt-3 h-4 w-full rounded bg-bg-surface" />
        </li>
      ))}
    </ul>
  );
}

export function MessageInboxClient() {
  const { address, isConnected } = useAccount();
  const { client, isInitializing, error, initialize } = useXmtpClient();
  const { conversations, isLoading } = useXmtpConversations(client);
  const myAddress = client ? getClientEthereumAddress(client) : address;

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-16 text-center">
        <h1 className="text-xl font-medium text-text-primary">Messages</h1>
        <p className="text-sm text-text-secondary">Connect from the Profile tab or wallet menu.</p>
        <Button type="button" variant="outline" asChild>
          <Link href="/profile/edit">Connect wallet</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-8 text-text-primary">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-medium">Messages</h1>
        {myAddress && (
          <p className="font-mono text-xs text-text-secondary">{shortAddress(myAddress)}</p>
        )}
      </div>

      {!client && (
        <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
          <p className="text-sm text-text-secondary">
            Enable end-to-end encrypted messaging with XMTP. You will be asked to sign a one-time message.
          </p>
          <Button type="button" disabled={isInitializing} onClick={() => void initialize()}>
            {isInitializing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Enabling…
              </>
            ) : (
              "Enable messaging"
            )}
          </Button>
        </div>
      )}

      {error && (
        <p className="rounded-md border border-status-error bg-bg-card p-3 text-sm text-status-error" role="alert">
          {error}
        </p>
      )}

      {client && isLoading && <InboxSkeleton />}

      {client && !isLoading && (
        <ul className="space-y-2" role="list">
          {conversations.length === 0 && (
            <li className="rounded-md border border-dashed border-border-default p-6 text-center text-sm text-text-secondary">
              No messages yet. Contact a seller from a listing page.
            </li>
          )}
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={`/messages/${conversation.id}`}
                className="block rounded-md border border-border-default bg-bg-surface p-4 transition-colors hover:border-border-hover"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-mono text-xs text-accent-warm">{shortAddress(conversation.peerAddress)}</p>
                  {conversation.lastMessageAt && (
                    <time
                      className="shrink-0 text-[10px] text-text-secondary"
                      dateTime={conversation.lastMessageAt.toISOString()}
                    >
                      {formatRelativeTime(conversation.lastMessageAt)}
                    </time>
                  )}
                </div>
                <p
                  className={`mt-2 line-clamp-2 text-sm ${
                    conversation.lastMessage ? "text-text-secondary" : "italic text-text-secondary"
                  }`}
                >
                  {conversation.lastMessage ?? "No messages yet"}
                </p>
                {conversation.unreadCount > 0 && (
                  <span className="mt-2 inline-flex min-w-5 items-center justify-center rounded-full bg-accent-warm px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
