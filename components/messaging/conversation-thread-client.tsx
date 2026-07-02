"use client";

import Link from "next/link";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import type { Dm } from "@xmtp/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAddress, type Address } from "viem";
import { useAccount } from "wagmi";

import { IdentityAvatar } from "@/components/identity/identity-avatar";
import { MessagingSetupCard } from "@/components/messaging/messaging-setup-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KarProBadge } from "@/components/ui/kar-pro-badge";
import { useMessagingStatus } from "@/hooks/use-messaging-status";
import { usePeerIdentity } from "@/hooks/use-peer-identity";
import { useXmtpClient } from "@/hooks/use-xmtp-client";
import { useXmtpMessages } from "@/hooks/use-xmtp-messages";
import { useXmtpConversations } from "@/hooks/use-xmtp-conversations";
import { ethereumAddressFromInboxState, formatRelativeTime, setLastSeen } from "@/lib/xmtp/helpers";

type Props = {
  conversationId: string;
};

function parsePeerAddress(raw: string | undefined): `0x${string}` | undefined {
  if (!raw) return undefined;
  try {
    return getAddress(raw);
  } catch {
    return undefined;
  }
}

export function ConversationThreadClient({ conversationId }: Props) {
  const { isConnected } = useAccount();
  const { client } = useXmtpClient();
  const { isReady, needsSetup } = useMessagingStatus();
  const { conversations } = useXmtpConversations(client);
  const { messages, isLoading, sendMessage, isSending } = useXmtpMessages(client, conversationId);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const peerAddressRaw = useMemo(
    () => conversations.find((conversation) => conversation.id === conversationId)?.peerAddress,
    [conversations, conversationId],
  );
  const listPeerAddress = parsePeerAddress(peerAddressRaw);
  const [resolvedPeerAddress, setResolvedPeerAddress] = useState<`0x${string}` | undefined>();
  const peerAddress = listPeerAddress ?? resolvedPeerAddress;
  const { displayName, isKarPro, profileHref } = usePeerIdentity(peerAddress);

  useEffect(() => {
    if (listPeerAddress) {
      setResolvedPeerAddress(listPeerAddress);
      return;
    }

    if (!client || !conversationId) return;

    let cancelled = false;

    void (async () => {
      try {
        const conversation = await client.conversations.getConversationById(conversationId);
        if (!conversation || cancelled) return;

        const peerInboxId = await (conversation as Dm).peerInboxId();
        const states = await client.preferences.getInboxStates([peerInboxId]);
        const resolved = ethereumAddressFromInboxState(states[0]);
        if (!cancelled && resolved) {
          setResolvedPeerAddress(resolved);
        }
      } catch {
        // Peer lookup failed — header falls back to unknown peer.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, conversationId, listPeerAddress]);

  useEffect(() => {
    setLastSeen(conversationId);
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (!isConnected) {
    return null;
  }

  if (!isReady || !client) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col justify-center gap-4 px-4 py-8 text-text-primary">
        <Button type="button" variant="ghost" size="sm" className="w-fit gap-2" asChild>
          <Link href="/messages">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </Link>
        </Button>
        {needsSetup ? (
          <MessagingSetupCard variant="full" context="account" />
        ) : (
          <p className="text-sm text-text-secondary" role="status">
            Loading messages…
          </p>
        )}
      </div>
    );
  }

  const onSend = async () => {
    if (!draft.trim()) return;
    setSendError(null);
    try {
      await sendMessage(draft);
      setDraft("");
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed to send message.");
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-lg flex-col px-4 py-4 text-text-primary md:h-[calc(100dvh-5rem)]">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-default pb-3">
        <Button type="button" variant="ghost" size="sm" className="h-9 w-9 p-0" asChild>
          <Link href="/messages" aria-label="Back to inbox">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          <Link href={profileHref} className="shrink-0">
            <IdentityAvatar address={peerAddress as Address | undefined} size={32} />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href={profileHref}
                className="block truncate font-sans text-sm font-medium text-text-primary transition-colors hover:text-accent-warm"
              >
                {displayName || "Unknown peer"}
              </Link>
              {isKarPro && <KarProBadge className="shrink-0" />}
            </div>
            <p className="text-[10px] text-text-secondary">End-to-end encrypted</p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-4">
        {isLoading && (
          <p className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading messages…
          </p>
        )}
        {!isLoading && messages.length === 0 && (
          <EmptyState
            variant="content"
            level="B"
            title="No messages yet."
            description="Say hello to start."
          />
        )}
        <ul className="space-y-3">
          {messages.map((message) => (
            <li
              key={message.id}
              className={`flex flex-col gap-1 ${message.isMine ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-md px-3 py-2 text-sm ${
                  message.isMine ? "bg-white text-bg-primary" : "bg-bg-surface text-text-primary"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              </div>
              <time
                className={`font-mono text-xs text-text-tertiary tabular-nums ${message.isMine ? "text-right" : "text-left"}`}
                dateTime={message.sentAt.toISOString()}
              >
                {formatRelativeTime(message.sentAt)}
              </time>
            </li>
          ))}
        </ul>
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 space-y-2 border-t border-border-default pt-3">
        {sendError && <p className="text-xs text-status-error">{sendError}</p>}
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message…"
            className="border-border-hover"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
          />
          <Button type="button" size="sm" disabled={isSending || !draft.trim()} onClick={() => void onSend()}>
            <Send className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
