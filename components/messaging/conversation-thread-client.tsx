"use client";

import Link from "next/link";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useXmtpClient } from "@/hooks/use-xmtp-client";
import { useXmtpMessages } from "@/hooks/use-xmtp-messages";
import { useXmtpConversations } from "@/hooks/use-xmtp-conversations";
import { formatRelativeTime, setLastSeen, shortAddress } from "@/lib/xmtp/helpers";

type Props = {
  conversationId: string;
};

export function ConversationThreadClient({ conversationId }: Props) {
  const { isConnected } = useAccount();
  const { client, isInitializing, error, initialize } = useXmtpClient();
  const { conversations } = useXmtpConversations(client);
  const { messages, isLoading, sendMessage, isSending } = useXmtpMessages(client, conversationId);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const peerAddress =
    conversations.find((conversation) => conversation.id === conversationId)?.peerAddress ??
    "Unknown peer";

  useEffect(() => {
    setLastSeen(conversationId);
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (!isConnected) {
    return null;
  }

  if (!client) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col justify-center gap-4 px-4 py-8 text-text-primary">
        <Button type="button" variant="ghost" size="sm" className="w-fit gap-2" asChild>
          <Link href="/messages">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </Link>
        </Button>
        <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
          <p className="text-sm text-text-secondary">Enable messaging to view this conversation.</p>
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
        {error && <p className="text-sm text-status-error">{error}</p>}
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
        <div>
          <p className="font-mono text-sm text-accent-warm">{shortAddress(peerAddress)}</p>
          <p className="text-[10px] text-text-secondary">End-to-end encrypted</p>
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
          <p className="text-center text-sm text-text-secondary">No messages yet. Say hello to start.</p>
        )}
        <ul className="space-y-3">
          {messages.map((message) => (
            <li
              key={message.id}
              className={`flex flex-col gap-1 ${message.isMine ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-md px-3 py-2 text-sm ${
                  message.isMine
                    ? "bg-bg-surface text-text-primary"
                    : "bg-bg-surface text-text-primary"
                }`}
              >
                <p className="mb-1 font-mono text-[10px] text-text-secondary">
                  {shortAddress(message.senderAddress)}
                </p>
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              </div>
              <time className="text-[10px] text-text-secondary" dateTime={message.sentAt.toISOString()}>
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
