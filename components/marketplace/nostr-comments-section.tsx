"use client";

import { Heart, Loader2, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { hexToBytes } from "viem";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useNostrKey } from "@/hooks/use-nostr-key";
import { NOSTR_RELAYS } from "@/lib/nostr/nostr-client";
import { cn } from "@/lib/utils";
import { shortAddress } from "@/lib/web3/wallet-display";
import { type Filter, finalizeEvent, getPublicKey } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";

type NostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  tags: string[][];
};

type CommentNode = {
  event: NostrEvent;
  parentId: string | null;
  optimistic?: boolean;
};

function parseParentId(ev: NostrEvent): string | null {
  const reply = ev.tags.find((t) => t[0] === "e" && t[3] === "reply");
  if (reply?.[1]) return reply[1];
  const firstE = ev.tags.find((t) => t[0] === "e");
  return firstE?.[1] ?? null;
}

function NostrCommentsSection({ tokenId }: { tokenId: string }) {
  const searchParams = useSearchParams();
  const highlightEventId = searchParams.get("e");
  const { isConnected, address } = useAccount();
  const { nostrPrivateKey, loading, ensureNostrKey } = useNostrKey();
  const [events, setEvents] = useState<Record<string, CommentNode>>({});
  const [likesByTarget, setLikesByTarget] = useState<Record<string, Set<string>>>({});
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);
  const [sendingError, setSendingError] = useState<string | null>(null);
  const [flashEventId, setFlashEventId] = useState<string | null>(null);

  const pool = useMemo(() => new SimplePool(), []);
  const mountedRef = useRef(true);
  const canPost = isConnected && !loading;
  const composerPlaceholder = canPost
    ? replyTo
      ? "Write a reply..."
      : "Share your thoughts..."
    : "Connect wallet to join the discussion";

  useEffect(() => {
    mountedRef.current = true;
    setFeedLoading(true);
    setFeedError(null);

    const listingTag = `listing:${tokenId}`;
    const since = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30;
    const filter: Filter = { kinds: [1, 7], "#d": [listingTag], since, limit: 500 };
    const sub = pool.subscribeMany(
      [...NOSTR_RELAYS],
      filter,
      {
        onevent: (ev: NostrEvent) => {
          if (ev.kind === 1) {
            const parentId = parseParentId(ev);
            setEvents((prev) => ({ ...prev, [ev.id]: { event: ev, parentId } }));
            return;
          }
          if (ev.kind === 7) {
            const target = ev.tags.find((t) => t[0] === "e")?.[1];
            if (!target) return;
            setLikesByTarget((prev) => {
              const next = { ...prev };
              const current = new Set(next[target] ?? []);
              current.add(ev.pubkey);
              next[target] = current;
              return next;
            });
          }
        },
        oneose: () => setFeedLoading(false),
        onclose: (reasons: string[]) => {
          setFeedLoading(false);
          if (reasons.length > 0) {
            setFeedError("Could not load comments. Please refresh the page.");
          }
        },
      },
    );
    const timeout = window.setTimeout(() => {
      if (mountedRef.current) setFeedLoading(false);
    }, 4500);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(timeout);
      try {
        sub.close();
      } catch {
        // ignore
      }
    };
  }, [pool, tokenId]);

  const ordered = useMemo(
    () =>
      Object.values(events)
        .sort((a, b) => a.event.created_at - b.event.created_at),
    [events],
  );
  const roots = ordered.filter((c) => !c.parentId);
  const byParent = useMemo(() => {
    const map: Record<string, CommentNode[]> = {};
    for (const c of ordered) {
      if (!c.parentId) continue;
      map[c.parentId] ??= [];
      map[c.parentId].push(c);
    }
    return map;
  }, [ordered]);

  useEffect(() => {
    if (!highlightEventId || feedLoading) return;
    const el = document.getElementById(`comment-${highlightEventId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashEventId(highlightEventId);
    const timer = window.setTimeout(() => setFlashEventId(null), 2500);
    return () => window.clearTimeout(timer);
  }, [highlightEventId, feedLoading, ordered.length]);

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
      const target = events[parentEventId]?.event;
      tags.push(["e", parentEventId, "", "reply"]);
      if (target?.pubkey) tags.push(["p", target.pubkey]);
    } else if (kind === 7 && parentEventId) {
      const target = events[parentEventId]?.event;
      tags.push(["e", parentEventId]);
      if (target?.pubkey) tags.push(["p", target.pubkey]);
    }
    const unsigned = {
      kind,
      created_at: Math.floor(Date.now() / 1000),
      content,
      tags,
    };
    const signed = finalizeEvent(unsigned, hexToBytes(privateKey));
    await Promise.any(pool.publish([...NOSTR_RELAYS], signed));
    return signed as unknown as NostrEvent;
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
    const optimistic: NostrEvent = {
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
        next[published.id] = { event: published, parentId: parseParentId(published) };
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
      <h2 className="font-sans text-base font-medium text-text-primary">Discussion</h2>

      {feedLoading && (
        <p className="font-sans text-xs text-text-secondary">Loading discussion...</p>
      )}
      {feedError && <p className="font-sans text-xs text-status-error">{feedError}</p>}
      {!feedLoading && roots.length === 0 && (
        <p className="rounded-md border border-border-default bg-bg-surface px-3 py-3 font-sans text-sm text-text-secondary">
          No comments yet. Be the first to share context or ask a question.
        </p>
      )}
      <ul className="space-y-3">
        {roots.map((root) => {
          const evmAddress = root.event.tags.find((t) => t[0] === "evm")?.[1] ?? null;
          return (
            <li
              key={root.event.id}
              id={`comment-${root.event.id}`}
              className={cn(
                "rounded-md border border-border-default bg-bg-surface p-3 transition-colors duration-300",
                flashEventId === root.event.id && "border-accent-warm",
              )}
            >
              <p className="font-sans text-xs text-text-secondary">
                {evmAddress ? (
                  <Link
                    href={`/profile/${evmAddress}`}
                    className="font-mono text-xs text-accent-warm hover:underline"
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
                              className="font-mono text-xs text-accent-warm hover:underline"
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
            <button className="ml-2 text-accent-warm" onClick={() => setReplyTo(null)} type="button">
              cancel
            </button>
          </p>
        )}
        <div className="flex justify-end">
          <Button type="button" onClick={() => void postComment()} disabled={!canPost || posting || !message.trim()}>
            {posting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
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
