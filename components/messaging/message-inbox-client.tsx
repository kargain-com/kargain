"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getAddress, type Address } from "viem";
import { useAccount } from "wagmi";

import { IdentityAvatar } from "@/components/identity/identity-avatar";
import { Button } from "@/components/ui/button";
import { useXmtpClient } from "@/hooks/use-xmtp-client";
import { usePeerIdentity } from "@/hooks/use-peer-identity";
import { useXmtpConversations, type ConversationSummary } from "@/hooks/use-xmtp-conversations";
import { openDmWithPeer } from "@/lib/xmtp/open-dm";
import { formatRelativeTime, getClientEthereumAddress, shortAddress } from "@/lib/xmtp/helpers";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";
import {
  isMessageablePeer,
  messagingWalletError,
  readAccountKindFromProvider,
} from "@/lib/web3/wallet-account";

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
        className="block rounded-md border border-border-default bg-bg-surface p-4 transition-colors hover:border-border-hover"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <IdentityAvatar address={peerAddress as Address | undefined} size={32} />
            <div className="min-w-0">
              <p className="truncate font-sans text-sm font-medium text-text-primary">
                {isLoading ? shortAddress(conversation.peerAddress) : displayName}
              </p>
              {isKarPro && (
                <span className="font-mono text-[10px] uppercase text-accent-warm">KarPro</span>
              )}
            </div>
          </div>
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
  );
}

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address, isConnected, connector } = useAccount();
  const { client, isInitializing, error, ensureInitialized } = useXmtpClient();
  const { conversations, isLoading } = useXmtpConversations(client);
  const myAddress = client ? getClientEthereumAddress(client) : address;

  const initialToRef = useRef<string | null | undefined>(undefined);
  if (initialToRef.current === undefined) {
    initialToRef.current = searchParams.get("to");
  }
  const strippedRef = useRef(false);
  const handledToRef = useRef(false);
  const [openingPeer, setOpeningPeer] = useState(false);
  const [toError, setToError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected) return;
    void ensureInitialized();
  }, [ensureInitialized, isConnected]);

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

    if (!isMessageablePeer(peer, DEFAULT_CHAIN_ID)) {
      handledToRef.current = true;
      setToError("This address cannot receive messages.");
      return;
    }

    if (!client) {
      if (!isInitializing) {
        void ensureInitialized();
      }
      return;
    }

    if (isLoading) return;

    handledToRef.current = true;
    setOpeningPeer(true);
    setToError(null);

    void (async () => {
      try {
        const provider = await connector?.getProvider?.();
        const peerKind = await readAccountKindFromProvider(provider, peer);
        const peerError = messagingWalletError(peerKind);
        if (peerError) {
          setToError(peerError);
          return;
        }

        const existing = findConversationByPeer(conversations, peer);
        if (existing) {
          router.push(`/messages/${existing.id}`);
          return;
        }

        const dm = await openDmWithPeer(client, peer);
        router.push(`/messages/${dm.id}`);
      } catch (e) {
        setToError(e instanceof Error ? e.message : "Could not open conversation.");
      } finally {
        setOpeningPeer(false);
      }
    })();
  }, [
    address,
    client,
    connector,
    conversations,
    ensureInitialized,
    isConnected,
    isInitializing,
    isLoading,
    router,
  ]);

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

  const showInboxLoading = !client && isInitializing;

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-8 text-text-primary">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-medium">Messages</h1>
        {myAddress && (
          <p className="font-mono text-xs text-text-secondary">{shortAddress(myAddress)}</p>
        )}
      </div>

      {openingPeer && (
        <p className="flex items-center gap-2 text-sm text-text-secondary" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Opening conversation…
        </p>
      )}

      {showInboxLoading && (
        <p className="flex items-center gap-2 text-sm text-text-secondary" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Setting up encrypted messaging…
        </p>
      )}

      {(error || toError) && (
        <p className="rounded-md border border-status-error bg-bg-card p-3 text-sm text-status-error" role="alert">
          {toError ?? error}
        </p>
      )}

      {client && isLoading && <InboxSkeleton />}

      {client && !isLoading && (
        <ul className="space-y-2" role="list">
          {conversations.length === 0 && (
            <li className="rounded-md border border-dashed border-border-default p-6 text-center text-sm text-text-secondary">
              No conversations yet.
            </li>
          )}
          {conversations.map((conversation) => (
            <ConversationInboxRow key={conversation.id} conversation={conversation} />
          ))}
        </ul>
      )}
    </div>
  );
}
