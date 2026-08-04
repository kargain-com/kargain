"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAddress, type Address } from "viem";
import { useAccount } from "wagmi";

import { ArrowLeftIcon, SendIcon, SpinnerIcon } from "@/components/ui/icons";
import { IdentityAvatar } from "@/components/identity/identity-avatar";
import { MessagingSetupCard } from "@/components/messaging/messaging-setup-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { KarProBadge } from "@/components/ui/kar-pro-badge";
import { useMessagingSession } from "@/hooks/use-messaging-session";
import { useRequestLocalMessagingClient } from "@/hooks/use-request-local-messaging-client";
import { usePeerIdentity } from "@/hooks/use-peer-identity";
import { useXmtpMessages } from "@/hooks/use-xmtp-messages";
import { useXmtpConversations } from "@/hooks/use-xmtp-conversations";
import {
  ethereumAddressFromInboxState,
  type XmtpDm,
} from "@/lib/messaging/adapters/xmtp-adapter";
import { formatRelativeTime } from "@/lib/format/relative-time";
import { takeComposeDraft } from "@/lib/messaging/compose-draft";
import { needsMessagingSetupCard } from "@/lib/messaging/snapshot-ui";

type Props = {
  conversationId: string;
};

const COMPOSER_MAX_HEIGHT_PX = 160;

function resizeComposer(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
}

function parsePeerAddress(raw: string | undefined): `0x${string}` | undefined {
  if (!raw) return undefined;
  try {
    return getAddress(raw);
  } catch {
    return undefined;
  }
}

function ConversationThreadBody({ conversationId }: Props) {
  const { isConnected } = useAccount();
  const { client, snapshot } = useMessagingSession();
  useRequestLocalMessagingClient(isConnected);
  const isReady = snapshot.state === "active" && client != null;
  const needsMessagingCard = needsMessagingSetupCard(snapshot);
  const { conversations, markConversationSeen } = useXmtpConversations();
  const { messages, isLoading, sendMessage, isSending } = useXmtpMessages(client, conversationId);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const draftSeededRef = useRef<string | null>(null);

  useEffect(() => {
    if (draftSeededRef.current === conversationId) return;
    draftSeededRef.current = conversationId;
    const staged = takeComposeDraft(conversationId);
    if (staged) setDraft(staged);
  }, [conversationId]);

  const peerAddressRaw = useMemo(
    () => conversations.find((conversation) => conversation.id === conversationId)?.peerAddress,
    [conversations, conversationId],
  );
  const listPeerAddress = parsePeerAddress(peerAddressRaw);
  const [fallbackPeerAddress, setFallbackPeerAddress] = useState<`0x${string}` | undefined>();
  const peerAddress = listPeerAddress ?? fallbackPeerAddress;
  const { displayName, isKarPro, profileHref } = usePeerIdentity(peerAddress);

  useEffect(() => {
    if (listPeerAddress || !client || !conversationId) return;

    let cancelled = false;

    void (async () => {
      try {
        const conversation = await client.conversations.getConversationById(conversationId);
        if (!conversation || cancelled) return;

        const peerInboxId = await (conversation as XmtpDm).peerInboxId();
        const states = await client.preferences.getInboxStates([peerInboxId]);
        const resolved = ethereumAddressFromInboxState(states[0]);
        if (!cancelled && resolved) {
          setFallbackPeerAddress(resolved);
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
    markConversationSeen(conversationId);
  }, [conversationId, markConversationSeen]);

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
            <ArrowLeftIcon size={16} className="h-4 w-4" aria-hidden />
            Back
          </Link>
        </Button>
        {needsMessagingCard ? (
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
      if (composerRef.current) {
        composerRef.current.style.height = "auto";
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Could not send message.");
    }
  };

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col px-4 py-8 text-text-primary">
      <div className="mb-4 flex items-center gap-3">
        <Button type="button" variant="ghost" size="sm" className="gap-2" asChild>
          <Link href="/messages">
            <ArrowLeftIcon size={16} className="h-4 w-4" aria-hidden />
            Back
          </Link>
        </Button>
        <IdentityAvatar address={peerAddress as Address | undefined} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {profileHref ? (
              <Link href={profileHref} className="truncate font-sans text-sm font-medium link">
                {displayName}
              </Link>
            ) : (
              <p className="truncate font-sans text-sm font-medium">{displayName}</p>
            )}
            {isKarPro && <KarProBadge className="shrink-0" />}
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto pb-4">
        {isLoading && (
          <p className="flex items-center gap-2 text-sm text-text-secondary" role="status">
            <SpinnerIcon className="h-4 w-4 animate-spin" aria-hidden />
            Loading messages…
          </p>
        )}

        {!isLoading && messages.length === 0 && (
          <EmptyState variant="content" level="A" title="No messages yet." className="py-8" />
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex flex-col ${message.isMine ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap break-words rounded-md px-3 py-2 text-sm ${
                message.isMine
                  ? "bg-white text-bg-primary"
                  : "bg-bg-surface text-text-primary"
              }`}
            >
              {message.content}
            </div>
            <time
              className={`mt-1 font-mono text-xs text-text-tertiary tabular-nums ${
                message.isMine ? "text-right" : "text-left"
              }`}
              dateTime={message.sentAt.toISOString()}
            >
              {formatRelativeTime(message.sentAt)}
            </time>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-border-default pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onSend();
        }}
      >
        <Textarea
          ref={composerRef}
          rows={1}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            resizeComposer(event.currentTarget);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;

            event.preventDefault();
            void onSend();
          }}
          placeholder="Message"
          disabled={isSending}
          aria-label="Message"
          className="min-h-11 max-h-40 resize-none overflow-y-auto"
        />
        <Button
          type="submit"
          size="sm"
          className="h-11 w-11 shrink-0 px-0"
          disabled={isSending || !draft.trim()}
          aria-label="Send"
        >
          <SendIcon size={16} className="h-4 w-4" aria-hidden />
        </Button>
      </form>

      {sendError && (
        <p className="mt-2 text-sm text-status-error" role="alert">
          {sendError}
        </p>
      )}
    </div>
  );
}

export function ConversationThreadClient({ conversationId }: Props) {
  return <ConversationThreadBody conversationId={conversationId} />;
}
