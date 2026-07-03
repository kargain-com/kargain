"use client";

import { Heart, Loader2, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { hexToBytes } from "viem";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/textarea";
import { useListingComments, parseListingCommentParentId } from "@/hooks/use-listing-comments";
import { useNostrKey } from "@/hooks/use-nostr-key";
import { usePassportQuickNavOptional } from "@/components/passport/passport-detail-panel-chrome";
import { sansLink } from "@/lib/design/instrument-classes";
import { NOSTR_RELAYS } from "@/lib/nostr/nostr-client";
import type { ListingCommentEvent } from "@/hooks/use-listing-comments";
import { cn } from "@/lib/utils";
import { shortAddress } from "@/lib/web3/wallet-display";
import { finalizeEvent, getPublicKey } from "nostr-tools";

type Props = {
  tokenId: string;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  embeddedInSheet?: boolean;
};

function NostrCommentsSection({
  tokenId,
  onDirtyChange,
  onBusyChange,
  embeddedInSheet = false,
}: Props) {
  const searchParams = useSearchParams();
  const highlightEventId = searchParams.get("e");
  const { isConnected, address } = useAccount();
  const { nostrPrivateKey, loading, ensureNostrKey } = useNostrKey();
  const {
    pool,
    events,
    setEvents,
    likesByTarget,
    setLikesByTarget,
    feedError,
    feedLoading,
    ordered,
    roots,
    byParent,
  } = useListingComments(tokenId);
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [sendingError, setSendingError] = useState<string | null>(null);
  const [flashEventId, setFlashEventId] = useState<string | null>(null);

  const passportQuickNav = usePassportQuickNavOptional();
  const canPost = isConnected && !loading;
  const composerPlaceholder = canPost
    ? replyTo
      ? "Write a reply..."
      : "Share your thoughts..."
    : "Connect wallet to join the discussion";

  const dirty = Boolean(message.trim() || replyTo);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    onBusyChange?.(posting);
  }, [posting, onBusyChange]);

  useEffect(() => {
    passportQuickNav?.setCommentCount(roots.length);
  }, [passportQuickNav, roots.length]);

  useEffect(() => {
    if (!highlightEventId || feedLoading) return;
    const el = document.getElementById(`comment-${highlightEventId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashEventId(highlightEventId);
    const timer = window.setTimeout(() => setFlashEventId(null), 2500);
    return () => window.clearTimeout(timer);
  }, [highlightEventId, feedLoading, ordered.length]);

  const resolveParentPubkey = async (parentEventId: string): Promise<string | null> => {
    const localPubkey = events[parentEventId]?.event.pubkey;
    if (localPubkey) return localPubkey;

    try {
      const results = await pool.querySync(
        [...NOSTR_RELAYS],
        { ids: [parentEventId], limit: 1 },
        { maxWait: 3000 },
      );
      return results[0]?.pubkey ?? null;
    } catch {
      return null;
    }
  };

  const publish = async (
    kind: 1 | 7,
    content: string,
    privateKey: `0x${string}`,
    parentEventId?: string,
  ) => {
    const authorPubkey = getPublicKey(hexToBytes(privateKey));
    const tags: string[][] = [["d", `listing:${tokenId}`]];
    if (kind === 1 && address) {
      tags.push(["evm", address.toLowerCase()]);
    }
    if (kind === 1 && parentEventId) {
      tags.push(["e", parentEventId, "", "reply"]);
      const targetPubkey = await resolveParentPubkey(parentEventId);
      if (targetPubkey && targetPubkey !== authorPubkey) {
        tags.push(["p", targetPubkey]);
      }
    } else if (kind === 7 && parentEventId) {
      tags.push(["e", parentEventId]);
      const targetPubkey = await resolveParentPubkey(parentEventId);
      if (targetPubkey && targetPubkey !== authorPubkey) {
        tags.push(["p", targetPubkey]);
      }
    }
    const unsigned = {
      kind,
      created_at: Math.floor(Date.now() / 1000),
      content,
      tags,
    };
    const signed = finalizeEvent(unsigned, hexToBytes(privateKey));
    await Promise.any(pool.publish([...NOSTR_RELAYS], signed));
    return signed as unknown as ListingCommentEvent;
  };

  const postComment = async () => {
    const text = message.trim();
    if (!text || posting || !isConnected) return;

    const key = nostrPrivateKey ?? (await ensureNostrKey());
    if (!key) return;
    const authorPubkey = getPublicKey(hexToBytes(key));

    setPosting(true);
    setSendingError(null);
    const tempId = `temp-${Date.now()}`;
    const optimisticTags: string[][] = [["d", `listing:${tokenId}`]];
    if (address) {
      optimisticTags.push(["evm", address.toLowerCase()]);
    }
    if (replyTo) {
      optimisticTags.push(["e", replyTo, "", "reply"]);
    }
    const optimistic: ListingCommentEvent = {
      id: tempId,
      pubkey: authorPubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: 1,
      content: text,
      tags: optimisticTags,
    };
    setEvents((prev) => ({ ...prev, [tempId]: { event: optimistic, parentId: replyTo, optimistic: true } }));
    setMessage("");
    setReplyTo(null);

    try {
      const published = await publish(1, text, key, optimistic.tags.find((t) => t[0] === "e")?.[1]);
      setEvents((prev) => {
        const next = { ...prev };
        delete next[tempId];
        next[published.id] = { event: published, parentId: parseListingCommentParentId(published) };
        return next;
      });
    } catch {
      setSendingError("Could not post your comment. Please try again.");
      setEvents((prev) => {
        const next = { ...prev };
        delete next[tempId];
        return next;
      });
    } finally {
      setPosting(false);
    }
  };

  const like = async (eventId: string) => {
    if (!isConnected) return;
    const key = nostrPrivateKey ?? (await ensureNostrKey());
    if (!key) return;
    const authorPubkey = getPublicKey(hexToBytes(key));
    setLikesByTarget((prev) => {
      const next = { ...prev };
      const current = new Set(next[eventId] ?? []);
      current.add(authorPubkey);
      next[eventId] = current;
      return next;
    });
    try {
      await publish(7, "+", key, eventId);
    } catch {
      setLikesByTarget((prev) => {
        const next = { ...prev };
        const current = new Set(next[eventId] ?? []);
        current.delete(authorPubkey);
        next[eventId] = current;
        return next;
      });
    }
  };

  return (
    <section className="space-y-4" aria-label="Discussion">
      {!embeddedInSheet && (
        <h2 className="font-sans text-base font-medium text-text-primary">Discussion</h2>
      )}

      {feedLoading && (
        <p className="font-sans text-xs text-text-secondary">Loading discussion...</p>
      )}
      {feedError && <p className="font-sans text-xs text-status-error">{feedError}</p>}
      {!feedLoading && roots.length === 0 && (
        <div className="rounded-md border border-border-default bg-bg-surface p-4">
          <EmptyState
            variant="content"
            level="B"
            title="No comments yet."
            description="Be the first to share context or ask a question."
          />
        </div>
      )}
      <ul className="space-y-3">
        {roots.map((root) => {
          const evmAddress = root.event.tags.find((t) => t[0] === "evm")?.[1] ?? null;
          return (
            <li
              key={root.event.id}
              id={`comment-${root.event.id}`}
              className={cn(
                "rounded-md border border-border-default bg-bg-surface p-4 transition-colors duration-300",
                flashEventId === root.event.id && "border-accent-warm",
              )}
            >
              <p className="font-sans text-xs text-text-secondary">
                {evmAddress ? (
                  <Link
                    href={`/profile/${evmAddress}`}
                    className="font-mono text-xs text-text-secondary hover:text-accent-warm focus-visible:text-accent-warm hover:underline"
                  >
                    {shortAddress(evmAddress as `0x${string}`)}
                  </Link>
                ) : (
                  <span className="font-mono text-xs text-text-tertiary">
                    Kargain user
                  </span>
                )}{" "}
                {root.optimistic ? "• sending..." : ""}
              </p>
              <p className="mt-1 font-sans text-sm text-text-primary">{root.event.content}</p>
              <div className="mt-2 flex items-center gap-3 font-sans text-xs">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-text-secondary disabled:opacity-50 disabled:pointer-events-none"
                  disabled={!isConnected}
                  onClick={() => setReplyTo(root.event.id)}
                >
                  <MessageCircle className="h-3.5 w-3.5" /> Reply
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-text-secondary disabled:opacity-50 disabled:pointer-events-none"
                  disabled={!isConnected}
                  onClick={() => void like(root.event.id)}
                >
                  <Heart className="h-3.5 w-3.5" /> {likesByTarget[root.event.id]?.size ?? 0}
                </button>
              </div>
              {(byParent[root.event.id] ?? []).length > 0 && (
                <ul className="mt-3 space-y-2 border-l border-border-default pl-3">
                  {(byParent[root.event.id] ?? []).map((child) => {
                    const childEvmAddress = child.event.tags.find((t) => t[0] === "evm")?.[1] ?? null;
                    return (
                      <li
                        key={child.event.id}
                        id={`comment-${child.event.id}`}
                        className={cn(
                          "transition-colors duration-300",
                          flashEventId === child.event.id && "rounded-sm border border-accent-warm px-2 py-1",
                        )}
                      >
                        <p className="font-sans text-xs text-text-secondary">
                          {childEvmAddress ? (
                            <Link
                              href={`/profile/${childEvmAddress}`}
                              className="font-mono text-xs text-text-secondary hover:text-accent-warm focus-visible:text-accent-warm hover:underline"
                            >
                              {shortAddress(childEvmAddress as `0x${string}`)}
                            </Link>
                          ) : (
                            <span className="font-mono text-xs text-text-tertiary">
                              Kargain user
                            </span>
                          )}
                        </p>
                        <p className="font-sans text-sm text-text-primary">{child.event.content}</p>
                        <button
                          type="button"
                          className="mt-1 inline-flex items-center gap-1 font-sans text-xs text-text-secondary disabled:opacity-50 disabled:pointer-events-none"
                          disabled={!isConnected}
                          onClick={() => void like(child.event.id)}
                        >
                          <Heart className="h-3 w-3" /> {likesByTarget[child.event.id]?.size ?? 0}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <div className="space-y-3 border-t border-border-default pt-4">
        <Textarea
          placeholder={composerPlaceholder}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={!canPost}
          rows={3}
          className="min-h-[5rem] resize-y"
        />
        {replyTo && (
          <p className="font-sans text-xs text-text-secondary">
            Replying to {replyTo.slice(0, 8)}...
            <button className={cn("ml-2", sansLink)} onClick={() => setReplyTo(null)} type="button">
              cancel
            </button>
          </p>
        )}
        <div className="flex justify-end">
          <Button type="button" onClick={() => void postComment()} disabled={!canPost || posting || !message.trim()}>
            {posting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden />
                Posting...
              </>
            ) : (
              "Post comment"
            )}
          </Button>
        </div>
        {sendingError && <p className="font-sans text-xs text-status-error">{sendingError}</p>}
      </div>

      <p className="font-sans text-xs text-text-tertiary">
        Comments are public and stored on decentralized relays. They cannot be deleted by the owner.
      </p>
    </section>
  );
}

export default NostrCommentsSection;
