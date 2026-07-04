"use client";

import { ChevronDown, Heart, Loader2, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { hexToBytes } from "viem";
import { useAccount } from "wagmi";
import { finalizeEvent, getPublicKey } from "nostr-tools";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/textarea";
import { useListingCommentsContextOptional } from "@/components/passport/listing-comments-provider";
import {
  parseListingCommentParentId,
  useListingComments,
  type ListingCommentEvent,
} from "@/hooks/use-listing-comments";
import { useNostrKey } from "@/hooks/use-nostr-key";
import { sansLink } from "@/lib/design/instrument-classes";
import { NOSTR_RELAYS } from "@/lib/nostr/nostr-client";
import { cn } from "@/lib/utils";
import { shortAddress } from "@/lib/web3/wallet-display";

type Props = {
  tokenId: string;
  density?: "default" | "compact";
  /** Hide the Discussion heading (e.g. inside a tab or rail card). */
  hideHeading?: boolean;
  initialVisibleRoots?: number;
};

const DEFAULT_VISIBLE_ROOTS = 5;

function CommentRowSkeleton({ compact }: { compact?: boolean }) {
  return (
    <li className={cn(compact ? "py-2.5" : "rounded-md border border-border-default bg-bg-surface p-4")}>
      <div className="h-3 w-24 animate-pulse rounded-sm bg-bg-card" />
      <div className="mt-2 h-4 w-full animate-pulse rounded-sm bg-bg-card" />
      {!compact && <div className="mt-1 h-4 max-w-[85%] animate-pulse rounded-sm bg-bg-card" />}
    </li>
  );
}

function NostrCommentsSection({
  tokenId,
  density = "default",
  hideHeading = false,
  initialVisibleRoots = DEFAULT_VISIBLE_ROOTS,
}: Props) {
  const compact = density === "compact";
  const searchParams = useSearchParams();
  const highlightEventId = searchParams.get("e");
  const { isConnected, address } = useAccount();
  const { nostrPrivateKey, loading, ensureNostrKey } = useNostrKey();
  const sharedFeed = useListingCommentsContextOptional();
  const localFeed = useListingComments(tokenId, { enabled: sharedFeed == null });
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
  } = sharedFeed ?? localFeed;

  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [sendingError, setSendingError] = useState<string | null>(null);
  const [flashEventId, setFlashEventId] = useState<string | null>(null);
  const [showAllRoots, setShowAllRoots] = useState(false);
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [composerFocused, setComposerFocused] = useState(false);

  const canPost = isConnected && !loading;
  const composerPlaceholder = canPost
    ? replyTo
      ? "Write a reply..."
      : "Share your thoughts..."
    : "Connect wallet to join the discussion";

  const visibleRoots = useMemo(() => {
    if (showAllRoots || roots.length <= initialVisibleRoots) return roots;
    return roots.slice(-initialVisibleRoots);
  }, [roots, showAllRoots, initialVisibleRoots]);

  const hiddenRootCount = Math.max(0, roots.length - visibleRoots.length);

  useEffect(() => {
    if (!highlightEventId || feedLoading) return;
    const scrollTimer = window.setTimeout(() => {
      const el = document.getElementById(`comment-${highlightEventId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashEventId(highlightEventId);
      const parentRoot = roots.find(
        (r) => r.event.id === highlightEventId || (byParent[r.event.id] ?? []).some((c) => c.event.id === highlightEventId),
      );
      if (parentRoot && (byParent[parentRoot.event.id] ?? []).length > 0) {
        setExpandedReplies((prev) => ({ ...prev, [parentRoot.event.id]: true }));
      }
      setShowAllRoots(true);
    }, 100);
    const flashTimer = window.setTimeout(() => setFlashEventId(null), 3000);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(flashTimer);
    };
  }, [highlightEventId, feedLoading, ordered.length, roots, byParent]);

  const resolveParentPubkey = async (parentEventId: string): Promise<string | null> => {
    const localPubkey = events[parentEventId]?.event.pubkey;
    if (localPubkey) return localPubkey;

    try {
      const results = await pool.querySync(
        [...NOSTR_RELAYS],
        { ids: [parentEventId], limit: 1 },
        { maxWait: 2000 },
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
    setEvents((prev) => ({
      ...prev,
      [tempId]: { event: optimistic, parentId: replyTo, optimistic: true },
    }));
    setMessage("");
    setReplyTo(null);
    setComposerFocused(false);

    try {
      const published = await publish(1, text, key, optimistic.tags.find((t) => t[0] === "e")?.[1]);
      setEvents((prev) => {
        const next = { ...prev };
        delete next[tempId];
        next[published.id] = {
          event: published,
          parentId: parseListingCommentParentId(published),
        };
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

  const authorLine = (evmAddress: string | null, optimistic?: boolean) => (
    <p className={cn("font-sans text-text-secondary", compact ? "text-[11px]" : "text-xs")}>
      {evmAddress ? (
        <Link
          href={`/profile/${evmAddress}`}
          className="font-mono text-text-secondary hover:text-accent-warm focus-visible:text-accent-warm hover:underline"
        >
          {shortAddress(evmAddress as `0x${string}`)}
        </Link>
      ) : (
        <span className="font-mono text-text-tertiary">Kargain user</span>
      )}
      {optimistic ? " · sending..." : ""}
    </p>
  );

  return (
    <section className={cn(compact ? "space-y-3" : "space-y-4")} aria-label="Discussion">
      {!hideHeading && (
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-sans text-base font-medium text-text-primary">Discussion</h2>
          {roots.length > 0 && (
            <span className="font-mono text-xs tabular-nums text-text-tertiary">{roots.length}</span>
          )}
        </div>
      )}

      <div className={cn(compact ? "min-h-[6rem]" : "min-h-[12rem]")}>
        {feedLoading && roots.length === 0 ? (
          <ul
            className={cn(compact ? "divide-y divide-border-default" : "space-y-3")}
            aria-busy="true"
            aria-label="Loading discussion"
          >
            <CommentRowSkeleton compact={compact} />
            <CommentRowSkeleton compact={compact} />
            {!compact && <CommentRowSkeleton />}
          </ul>
        ) : (
          <div className="animate-in fade-in duration-200">
            {feedError && <p className="font-sans text-xs text-status-error">{feedError}</p>}
            {roots.length === 0 && (
              <div
                className={cn(
                  compact
                    ? "py-3"
                    : "rounded-md border border-border-default bg-bg-surface p-4",
                )}
              >
                <EmptyState
                  variant="content"
                  level="B"
                  title="No comments yet."
                  description="Be the first to share context or ask a question."
                />
              </div>
            )}
            {hiddenRootCount > 0 && (
              <button
                type="button"
                className={cn("mb-2 inline-flex min-h-11 items-center gap-1", sansLink)}
                onClick={() => setShowAllRoots(true)}
              >
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                Show earlier ({hiddenRootCount})
              </button>
            )}
            <ul
              className={cn(
                compact
                  ? "divide-y divide-border-default border-y border-border-default"
                  : "space-y-3",
              )}
            >
              {visibleRoots.map((root) => {
                const evmAddress = root.event.tags.find((t) => t[0] === "evm")?.[1] ?? null;
                const replies = byParent[root.event.id] ?? [];
                const repliesOpen = expandedReplies[root.event.id] ?? false;
                return (
                  <li
                    key={root.event.id}
                    id={`comment-${root.event.id}`}
                    className={cn(
                      compact
                        ? "py-2.5 transition-colors duration-200"
                        : "rounded-md border border-border-default bg-bg-surface p-4 transition-colors duration-200",
                      flashEventId === root.event.id && "bg-accent-warm/5",
                    )}
                  >
                    {authorLine(evmAddress, root.optimistic)}
                    <p
                      className={cn(
                        "mt-0.5 font-sans text-text-primary",
                        compact ? "text-sm leading-snug" : "text-sm leading-[1.5]",
                      )}
                    >
                      {root.event.content}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 font-sans text-xs">
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center gap-1 text-text-secondary disabled:pointer-events-none disabled:opacity-50"
                        disabled={!isConnected}
                        onClick={() => {
                          setReplyTo(root.event.id);
                          setComposerFocused(true);
                        }}
                      >
                        <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.5} /> Reply
                      </button>
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center gap-1 text-text-secondary disabled:pointer-events-none disabled:opacity-50"
                        disabled={!isConnected}
                        onClick={() => void like(root.event.id)}
                      >
                        <Heart className="h-3.5 w-3.5" strokeWidth={1.5} />{" "}
                        {likesByTarget[root.event.id]?.size ?? 0}
                      </button>
                      {replies.length > 0 && (
                        <button
                          type="button"
                          className="inline-flex min-h-11 items-center gap-1 text-text-tertiary"
                          onClick={() =>
                            setExpandedReplies((prev) => ({
                              ...prev,
                              [root.event.id]: !repliesOpen,
                            }))
                          }
                        >
                          <ChevronDown
                            className={cn(
                              "h-3.5 w-3.5 transition-transform",
                              repliesOpen && "rotate-180",
                            )}
                            strokeWidth={1.5}
                            aria-hidden
                          />
                          {replies.length} {replies.length === 1 ? "reply" : "replies"}
                        </button>
                      )}
                    </div>
                    {repliesOpen && replies.length > 0 && (
                      <ul className="mt-2 space-y-2 border-l border-border-default pl-3">
                        {replies.map((child) => {
                          const childEvm =
                            child.event.tags.find((t) => t[0] === "evm")?.[1] ?? null;
                          return (
                            <li
                              key={child.event.id}
                              id={`comment-${child.event.id}`}
                              className={cn(
                                flashEventId === child.event.id && "bg-accent-warm/5",
                              )}
                            >
                              {authorLine(childEvm)}
                              <p className="font-sans text-sm text-text-primary">
                                {child.event.content}
                              </p>
                              <button
                                type="button"
                                className="mt-0.5 inline-flex min-h-11 items-center gap-1 font-sans text-xs text-text-secondary disabled:pointer-events-none disabled:opacity-50"
                                disabled={!isConnected}
                                onClick={() => void like(child.event.id)}
                              >
                                <Heart className="h-3 w-3" strokeWidth={1.5} />{" "}
                                {likesByTarget[child.event.id]?.size ?? 0}
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
          </div>
        )}
      </div>

      <div
        className={cn(
          "border-t border-border-default",
          compact ? "space-y-2 pt-3" : "space-y-3 pt-4",
        )}
      >
        <Textarea
          placeholder={composerPlaceholder}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onFocus={() => setComposerFocused(true)}
          disabled={!canPost}
          rows={compact && !composerFocused && !message && !replyTo ? 1 : 3}
          className={cn("resize-y", compact ? "min-h-11" : "min-h-[5rem]")}
        />
        {replyTo && (
          <p className="font-sans text-xs text-text-secondary">
            Replying to {replyTo.slice(0, 8)}...
            <button
              className={cn("ml-2", sansLink)}
              onClick={() => setReplyTo(null)}
              type="button"
            >
              cancel
            </button>
          </p>
        )}
        {(composerFocused || message.trim() || replyTo || !compact) && (
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={() => void postComment()}
              disabled={!canPost || posting || !message.trim()}
            >
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
        )}
        {sendingError && <p className="font-sans text-xs text-status-error">{sendingError}</p>}
      </div>

      {!compact && (
        <p className="font-sans text-xs text-text-tertiary">
          Comments are public and stored on decentralized relays. They cannot be deleted by the
          owner.
        </p>
      )}
    </section>
  );
}

export default NostrCommentsSection;
