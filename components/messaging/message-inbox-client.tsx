"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAddress, type Address } from "viem";
import { useAccount } from "wagmi";

import { CommentIcon, SpinnerIcon } from "@/components/ui/icons";
import { IdentityAvatar } from "@/components/identity/identity-avatar";
import { MessagingCatchUpBanner } from "@/components/messaging/messaging-catch-up-banner";
import { MessagingSetupCard } from "@/components/messaging/messaging-setup-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { KarProBadge } from "@/components/ui/kar-pro-badge";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { useMessagingSession } from "@/hooks/use-messaging-session";
import { useRequestLocalMessagingClient } from "@/hooks/use-request-local-messaging-client";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { usePeerIdentity } from "@/hooks/use-peer-identity";
import { useXmtpConversations, type ConversationSummary } from "@/hooks/use-xmtp-conversations";
import {
  acceptConversationRequest,
  blockConversation,
} from "@/lib/messaging/consent-actions";
import { ContactPeerError, contactPeer } from "@/lib/messaging/contact-peer";
import { getClientEthereumAddress } from "@/lib/messaging/adapters/xmtp-adapter";
import { formatRelativeTime } from "@/lib/format/relative-time";
import { needsMessagingSetupCard } from "@/lib/messaging/snapshot-ui";
import { shortAddress } from "@/lib/web3/wallet-display";
import { isMessageablePeerOnCommercialChains } from "@/lib/web3/wallet-account";
import { cn } from "@/lib/utils";

type InboxTab = "inbox" | "requests";

function parsePeerAddress(raw: string): `0x${string}` | undefined {
  try {
    return getAddress(raw);
  } catch {
    return undefined;
  }
}

function findConversationByPeer(
  conversations: ConversationSummary[],
  peer: `0x${string}`,
): ConversationSummary | undefined {
  const normalized = peer.toLowerCase();
  return conversations.find((conversation) => {
    try {
      return getAddress(conversation.peerAddress).toLowerCase() === normalized;
    } catch {
      return false;
    }
  });
}

function ConversationInboxRow({ conversation }: { conversation: ConversationSummary }) {
  const peerAddress = parsePeerAddress(conversation.peerAddress);
  const { displayName, isKarPro, isLoading } = usePeerIdentity(peerAddress);

  return (
    <li>
      <Link
        href={`/messages/${conversation.id}`}
        className="block rounded-md border border-border-default bg-bg-surface p-3 transition-colors hover:border-border-hover"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <IdentityAvatar address={peerAddress as Address | undefined} size={32} />
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate font-sans text-sm font-medium text-text-primary">
                {isLoading ? shortAddress(conversation.peerAddress) : displayName}
              </p>
              {isKarPro && <KarProBadge className="shrink-0" />}
            </div>
          </div>
          {conversation.lastMessageAt && (
            <time
              className="shrink-0 font-mono text-[10px] text-text-secondary tabular-nums"
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
  );
}

function ConversationRequestRow({
  conversation,
  busy,
  onAccept,
  onBlock,
}: {
  conversation: ConversationSummary;
  busy: boolean;
  onAccept: (id: string) => void;
  onBlock: (id: string) => void;
}) {
  const peerAddress = parsePeerAddress(conversation.peerAddress);
  const { displayName, isKarPro, isLoading } = usePeerIdentity(peerAddress);

  return (
    <li className="rounded-md border border-border-default bg-bg-surface p-3">
      <Link
        href={`/messages/${conversation.id}`}
        className="block transition-colors hover:opacity-90"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <IdentityAvatar address={peerAddress as Address | undefined} size={32} />
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate font-sans text-sm font-medium text-text-primary">
                {isLoading ? shortAddress(conversation.peerAddress) : displayName}
              </p>
              {isKarPro && <KarProBadge className="shrink-0" />}
            </div>
          </div>
          {conversation.lastMessageAt && (
            <time
              className="shrink-0 font-mono text-[10px] text-text-secondary tabular-nums"
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
      </Link>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={() => onAccept(conversation.id)}
        >
          Accept
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => onBlock(conversation.id)}
        >
          Block
        </Button>
      </div>
    </li>
  );
}

function InboxSkeleton() {
  return (
    <ul className="space-y-2" aria-hidden>
      {Array.from({ length: 4 }).map((_, index) => (
        <li key={index} className="animate-pulse rounded-md border border-border-default bg-bg-surface p-3">
          <div className="h-3 w-24 rounded bg-bg-surface" />
          <div className="mt-3 h-4 w-full rounded bg-bg-surface" />
        </li>
      ))}
    </ul>
  );
}

function tabFromSearchParams(searchParams: URLSearchParams): InboxTab {
  return searchParams.get("tab") === "requests" ? "requests" : "inbox";
}

export function MessageInboxClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = tabFromSearchParams(searchParams);
  const { address, isConnected, connector } = useAccount();
  const { client, session, snapshot } = useMessagingSession();
  useRequestLocalMessagingClient(isConnected);
  const needsMessagingCard = needsMessagingSetupCard(snapshot);
  const isReady = snapshot.state === "active" && client != null;
  const {
    conversations,
    requestConversations,
    requestCount,
    isLoading,
    refreshConsentLists,
  } = useXmtpConversations();
  const myAddress = client ? getClientEthereumAddress(client) : address;
  const [actionBusy, setActionBusy] = useState(false);

  const setTab = useCallback(
    (tab: InboxTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "requests") {
        params.set("tab", "requests");
      } else {
        params.delete("tab");
      }
      const query = params.toString();
      router.replace(query ? `/messages?${query}` : "/messages");
    },
    [router, searchParams],
  );

  const initialToRef = useRef<string | null | undefined>(undefined);
  if (initialToRef.current === undefined) {
    initialToRef.current = searchParams.get("to");
  }
  const strippedRef = useRef(false);
  const handledToRef = useRef(false);
  const [openingPeer, setOpeningPeer] = useState(false);
  const [toError, setToError] = useState<string | null>(null);

  const pendingPeer = initialToRef.current ? parsePeerAddress(initialToRef.current) : undefined;
  const { profile: peerProfile } = useNostrProfile(pendingPeer);

  useEffect(() => {
    if (strippedRef.current) return;
    if (!initialToRef.current) return;
    strippedRef.current = true;
    router.replace("/messages");
  }, [router]);

  useEffect(() => {
    if (handledToRef.current) return;

    const raw = initialToRef.current;
    if (!raw) {
      handledToRef.current = true;
      return;
    }

    let peer: `0x${string}`;
    try {
      peer = getAddress(raw);
    } catch {
      handledToRef.current = true;
      setToError("Invalid recipient address.");
      return;
    }

    if (!isConnected) {
      return;
    }

    if (address && peer.toLowerCase() === address.toLowerCase()) {
      handledToRef.current = true;
      setToError("You cannot message yourself.");
      return;
    }

    if (!isMessageablePeerOnCommercialChains(peer)) {
      handledToRef.current = true;
      setToError("This address cannot receive messages.");
      return;
    }

    if (!isReady || !client) {
      if (needsMessagingCard && isConnected && initialToRef.current) {
        setToError("Enable private messages to open this conversation.");
      }
      return;
    }

    if (isLoading) return;

    handledToRef.current = true;
    setOpeningPeer(true);
    setToError(null);

    void (async () => {
      try {
        const existing =
          findConversationByPeer(conversations, peer) ??
          findConversationByPeer(requestConversations, peer);
        if (existing) {
          router.push(`/messages/${existing.id}`);
          return;
        }

        const provider = await connector?.getProvider?.();
        const dm = await contactPeer({
          client,
          ensureReady: async () => session?.getXmtpClient() ?? null,
          peerAddress: peer,
          nostrProfile: peerProfile,
          provider,
        });
        router.push(`/messages/${dm.id}`);
      } catch (e) {
        const message =
          e instanceof ContactPeerError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Could not open conversation.";
        setToError(message);
      } finally {
        setOpeningPeer(false);
      }
    })();
  }, [
    address,
    client,
    connector,
    conversations,
    requestConversations,
    isConnected,
    isLoading,
    isReady,
    needsMessagingCard,
    session,
    peerProfile,
    router,
    snapshot.state,
  ]);

  const onAccept = useCallback(
    async (conversationId: string) => {
      if (!client || actionBusy) return;
      setActionBusy(true);
      try {
        await acceptConversationRequest(client, conversationId);
        refreshConsentLists();
      } finally {
        setActionBusy(false);
      }
    },
    [actionBusy, client, refreshConsentLists],
  );

  const onBlock = useCallback(
    async (conversationId: string) => {
      if (!client || actionBusy) return;
      setActionBusy(true);
      try {
        await blockConversation(client, conversationId);
        refreshConsentLists();
      } finally {
        setActionBusy(false);
      }
    },
    [actionBusy, client, refreshConsentLists],
  );

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-16 text-center">
        <h1 className="text-xl font-medium text-text-primary">Messages</h1>
        <div className="space-y-3">
          <EmptyState
            variant="infrastructure"
            level="B"
            title="Connect your wallet to view your messages."
          />
          <WalletLoginButton />
        </div>
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

      {needsMessagingCard && !openingPeer && (
        <MessagingSetupCard variant="full" context="account" />
      )}

      {!needsMessagingCard && <MessagingCatchUpBanner />}

      {openingPeer && (
        <p className="flex items-center gap-2 text-sm text-text-secondary" role="status">
          <SpinnerIcon className="h-4 w-4 animate-spin" aria-hidden />
          Opening conversation…
        </p>
      )}

      {snapshot.state === "reconciling" && !needsMessagingCard && (
        <p className="flex items-center gap-2 text-sm text-text-secondary" role="status">
          <SpinnerIcon className="h-4 w-4 animate-spin" aria-hidden />
          Restoring messages…
        </p>
      )}

      {toError && (
        <p className="rounded-md border border-status-error bg-bg-card p-3 text-sm text-status-error" role="alert">
          {toError}
        </p>
      )}

      {isReady && (
        <div className="border-b border-border-default">
          <nav className="flex gap-6" aria-label="Message lists">
            <button
              type="button"
              onClick={() => setTab("inbox")}
              className={cn(
                "border-b-2 pb-3 font-sans text-sm transition-colors duration-150",
                activeTab === "inbox"
                  ? "border-text-primary font-medium text-text-primary"
                  : "border-transparent font-normal text-text-secondary hover:text-text-primary",
              )}
            >
              Inbox
            </button>
            <button
              type="button"
              onClick={() => setTab("requests")}
              className={cn(
                "border-b-2 pb-3 font-sans text-sm transition-colors duration-150",
                activeTab === "requests"
                  ? "border-text-primary font-medium text-text-primary"
                  : "border-transparent font-normal text-text-secondary hover:text-text-primary",
              )}
            >
              Requests
              {requestCount > 0 && (
                <span className="ml-1.5 font-mono text-xs text-text-tertiary tabular-nums">
                  {requestCount > 99 ? "99+" : requestCount}
                </span>
              )}
            </button>
          </nav>
        </div>
      )}

      {isReady && isLoading && <InboxSkeleton />}

      {isReady && !isLoading && activeTab === "inbox" && (
        <ul className="space-y-2" role="list">
          {conversations.length === 0 && (
            <li>
              <EmptyState
                variant="content"
                level="A"
                icon={CommentIcon}
                title="No conversations yet"
                description="Conversations with buyers and sellers appear here. Start one from any listing with Message seller."
                action={{ label: "Browse marketplace", href: "/" }}
              />
            </li>
          )}
          {conversations.map((conversation) => (
            <ConversationInboxRow key={conversation.id} conversation={conversation} />
          ))}
        </ul>
      )}

      {isReady && !isLoading && activeTab === "requests" && (
        <ul className="space-y-2" role="list">
          {requestConversations.length === 0 && (
            <li>
              <EmptyState
                variant="content"
                level="A"
                icon={CommentIcon}
                title="No requests"
                description="Message requests from people you have not talked with appear here."
              />
            </li>
          )}
          {requestConversations.map((conversation) => (
            <ConversationRequestRow
              key={conversation.id}
              conversation={conversation}
              busy={actionBusy}
              onAccept={(id) => void onAccept(id)}
              onBlock={(id) => void onBlock(id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
