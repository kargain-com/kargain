"use client";

import { Heart, Loader2, MessageCircle, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { hexToBytes } from "viem";
import { useWalletClient } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNostrKey } from "@/hooks/use-nostr-key";
import { exportNsec, importNsec, type WalletSigner } from "@/lib/nostr/key-manager";
import { NOSTR_RELAYS } from "@/lib/nostr/nostr-client";
import { type Filter, finalizeEvent, getPublicKey, nip19 } from "nostr-tools";
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

function shortPk(pk: string) {
  return `${pk.slice(0, 8)}...${pk.slice(-6)}`;
}

function npubLink(pubkey: string) {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `https://njump.me/${npub}`;
  } catch {
    return `https://njump.me/${pubkey}`;
  }
}

function parseParentId(ev: NostrEvent): string | null {
  const reply = ev.tags.find((t) => t[0] === "e" && t[3] === "reply");
  if (reply?.[1]) return reply[1];
  const firstE = ev.tags.find((t) => t[0] === "e");
  return firstE?.[1] ?? null;
}

function NostrCommentsSection({ tokenId }: { tokenId: string }) {
  const { nostrPrivateKey, loading, error: keyError, statusMessage, refresh, storageBackend } = useNostrKey();
  const { data: walletClient } = useWalletClient();
  const [events, setEvents] = useState<Record<string, CommentNode>>({});
  const [likesByTarget, setLikesByTarget] = useState<Record<string, Set<string>>>({});
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);
  const [sendingError, setSendingError] = useState<string | null>(null);
  const [nsecExport, setNsecExport] = useState("");
  const [nsecImportValue, setNsecImportValue] = useState("");
  const [nsecBusy, setNsecBusy] = useState(false);
  const [nsecError, setNsecError] = useState<string | null>(null);

  const pool = useMemo(() => new SimplePool(), []);
  const mountedRef = useRef(true);
  const pubkey = useMemo(
    () => (nostrPrivateKey ? getPublicKey(hexToBytes(nostrPrivateKey)) : null),
    [nostrPrivateKey],
  );
  const signer = useMemo<WalletSigner | null>(() => {
    const addr = walletClient?.account?.address;
    if (!walletClient || !addr) return null;
    return {
      address: addr,
      signMessage: async (message) => {
        const sig = await walletClient.signMessage({ message });
        return sig as `0x${string}`;
      },
    };
  }, [walletClient]);

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
          if (reasons.length > 0) setFeedError(`Relay closed: ${reasons[0]}`);
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

  const publish = async (kind: 1 | 7, content: string, parentEventId?: string) => {
    if (!nostrPrivateKey || !pubkey) throw new Error("No Nostr key.");
    const tags: string[][] = [["d", `listing:${tokenId}`]];
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
    const signed = finalizeEvent(unsigned, hexToBytes(nostrPrivateKey));
    await Promise.any(pool.publish([...NOSTR_RELAYS], signed));
    return signed as unknown as NostrEvent;
  };

  const postComment = async () => {
    const text = message.trim();
    if (!text || posting) return;
    if (!nostrPrivateKey || !pubkey) return;

    setPosting(true);
    setSendingError(null);
    const tempId = `temp-${Date.now()}`;
    const optimistic: NostrEvent = {
      id: tempId,
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: 1,
      content: text,
      tags: replyTo ? [["e", replyTo, "", "reply"], ["d", `listing:${tokenId}`]] : [["d", `listing:${tokenId}`]],
    };
    setEvents((prev) => ({ ...prev, [tempId]: { event: optimistic, parentId: replyTo, optimistic: true } }));
    setMessage("");
    setReplyTo(null);

    try {
      const published = await publish(1, text, optimistic.tags.find((t) => t[0] === "e")?.[1]);
      setEvents((prev) => {
        const next = { ...prev };
        delete next[tempId];
        next[published.id] = { event: published, parentId: parseParentId(published) };
        return next;
      });
    } catch {
      setSendingError("Could not publish your comment to relays. Please retry.");
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
    if (!nostrPrivateKey || !pubkey) return;
    setLikesByTarget((prev) => {
      const next = { ...prev };
      const current = new Set(next[eventId] ?? []);
      current.add(pubkey);
      next[eventId] = current;
      return next;
    });
    try {
      await publish(7, "+", eventId);
    } catch {
      setLikesByTarget((prev) => {
        const next = { ...prev };
        const current = new Set(next[eventId] ?? []);
        current.delete(pubkey);
        next[eventId] = current;
        return next;
      });
    }
  };

  const handleExportNsec = async () => {
    if (!signer) return;
    setNsecBusy(true);
    setNsecError(null);
    try {
      const nsec = await exportNsec(signer);
      setNsecExport(nsec);
    } catch (e) {
      setNsecError(e instanceof Error ? e.message : "Failed to export nsec.");
    } finally {
      setNsecBusy(false);
    }
  };

  const handleImportNsec = async () => {
    if (!signer || !nsecImportValue.trim()) return;
    setNsecBusy(true);
    setNsecError(null);
    try {
      await importNsec(signer, nsecImportValue.trim());
      await refresh();
      setNsecImportValue("");
      setNsecExport("");
    } catch (e) {
      setNsecError(e instanceof Error ? e.message : "Failed to import nsec.");
    } finally {
      setNsecBusy(false);
    }
  };

  return (
    <section className="space-y-4" aria-label="Comments">
      <h2 className="font-sans text-base font-medium text-text-primary">Comments</h2>
      <div className="space-y-2 rounded-md border border-border-default bg-bg-surface p-3">
        <p className="text-xs text-text-secondary">
          Nostr identity backup (cross-browser / device) · {statusMessage}
          {storageBackend ? ` · storage: ${storageBackend}` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={!signer || nsecBusy} onClick={() => void handleExportNsec()}>
            Export nsec
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!signer || nsecBusy || !nsecImportValue.trim()} onClick={() => void handleImportNsec()}>
            Import nsec
          </Button>
        </div>
        {nsecExport && (
          <Input
            value={nsecExport}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
            aria-label="Exported Nostr private key (nsec)"
          />
        )}
        <Input
          placeholder="Paste nsec to import"
          value={nsecImportValue}
          onChange={(e) => setNsecImportValue(e.target.value)}
          disabled={!signer || nsecBusy}
          className="font-mono text-xs"
          aria-label="Import Nostr private key (nsec)"
        />
        {nsecError && <p className="text-xs text-status-error">{nsecError}</p>}
        {keyError && <p className="text-xs text-status-error">{keyError}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Input
          placeholder={loading ? "Unlocking Nostr key..." : replyTo ? "Write a reply..." : "Write a comment..."}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={loading || !nostrPrivateKey}
        />
        <Button type="button" onClick={() => void postComment()} disabled={!nostrPrivateKey || posting || !message.trim()}>
          {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      {sendingError && <p className="text-xs text-status-error">{sendingError}</p>}
      {replyTo && (
        <p className="text-xs text-text-secondary">
          Replying to {replyTo.slice(0, 8)}...
          <button className="ml-2 text-accent-warm" onClick={() => setReplyTo(null)} type="button">
            cancel
          </button>
        </p>
      )}

      {feedLoading && (
        <p className="text-xs text-text-secondary">Loading comments from public relays...</p>
      )}
      {feedError && <p className="text-xs text-status-error">{feedError}</p>}
      {!feedLoading && roots.length === 0 && (
        <p className="rounded-md border border-border-default bg-bg-surface px-3 py-3 text-sm text-text-secondary">
          No comments yet. Be the first to share context or ask a question.
        </p>
      )}
      <ul className="space-y-3">
        {roots.map((root) => (
          <li key={root.event.id} className="rounded-md border border-border-default bg-bg-surface p-3">
            <p className="text-xs text-text-secondary">
              <a
                href={npubLink(root.event.pubkey)}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-2 hover:text-text-primary hover:underline"
              >
                {shortPk(root.event.pubkey)}
              </a>{" "}
              {root.optimistic ? "• sending..." : ""}
            </p>
            <p className="mt-1 text-sm text-text-primary">{root.event.content}</p>
            <div className="mt-2 flex items-center gap-3 text-xs">
              <button type="button" className="inline-flex items-center gap-1 text-text-secondary" onClick={() => setReplyTo(root.event.id)}>
                <MessageCircle className="h-3.5 w-3.5" /> Reply
              </button>
              <button type="button" className="inline-flex items-center gap-1 text-text-secondary" onClick={() => void like(root.event.id)}>
                <Heart className="h-3.5 w-3.5" /> {likesByTarget[root.event.id]?.size ?? 0}
              </button>
            </div>
            {(byParent[root.event.id] ?? []).length > 0 && (
              <ul className="mt-3 space-y-2 border-l border-border-default pl-3">
                {(byParent[root.event.id] ?? []).map((child) => (
                  <li key={child.event.id}>
                    <p className="text-xs text-text-secondary">
                      <a
                        href={npubLink(child.event.pubkey)}
                        target="_blank"
                        rel="noreferrer"
                        className="underline-offset-2 hover:text-text-primary hover:underline"
                      >
                        {shortPk(child.event.pubkey)}
                      </a>
                    </p>
                    <p className="text-sm text-text-primary">{child.event.content}</p>
                    <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs text-text-secondary" onClick={() => void like(child.event.id)}>
                      <Heart className="h-3 w-3" /> {likesByTarget[child.event.id]?.size ?? 0}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default NostrCommentsSection;
