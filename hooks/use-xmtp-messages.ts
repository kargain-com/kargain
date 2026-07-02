"use client";

import { SortDirection, type AsyncStreamProxy, type DecodedMessage, type Dm } from "@xmtp/client";
import { useCallback, useEffect, useRef, useState } from "react";

import type { XmtpClient } from "@/lib/xmtp/helpers";
import {
  ethereumAddressFromInboxState,
  getClientEthereumAddress,
  messageText,
} from "@/lib/xmtp/helpers";

export type XmtpMessage = {
  id: string;
  senderAddress: string;
  content: string;
  sentAt: Date;
  isMine: boolean;
};

function mapDecodedMessage(
  message: DecodedMessage,
  client: XmtpClient,
  addressByInbox: Map<string, string>,
): XmtpMessage {
  const myInboxId = client.inboxId;
  const isMine = Boolean(myInboxId && message.senderInboxId === myInboxId);
  const clientAddress = getClientEthereumAddress(client);
  const senderAddress = isMine
    ? (clientAddress ?? message.senderInboxId)
    : (addressByInbox.get(message.senderInboxId) ?? message.senderInboxId);

  return {
    id: message.id,
    senderAddress,
    content: messageText(message),
    sentAt: message.sentAt,
    isMine,
  };
}

export function useXmtpMessages(
  client: XmtpClient | null,
  conversationId: string | null,
): {
  messages: XmtpMessage[];
  isLoading: boolean;
  sendMessage: (text: string) => Promise<void>;
  isSending: boolean;
} {
  const [messages, setMessages] = useState<XmtpMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const addressByInboxRef = useRef(new Map<string, string>());

  const sendMessage = useCallback(
    async (text: string) => {
      if (!client || !conversationId) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      const conversation = await client.conversations.getConversationById(conversationId);
      if (!conversation) throw new Error("Conversation not found.");

      const clientAddress = getClientEthereumAddress(client);
      const optimisticId = `optimistic-${Date.now()}`;
      const optimistic: XmtpMessage = {
        id: optimisticId,
        senderAddress: clientAddress ?? "me",
        content: trimmed,
        sentAt: new Date(),
        isMine: true,
      };

      setMessages((prev) => [...prev, optimistic]);
      setIsSending(true);

      try {
        await conversation.sendText(trimmed);
        const refreshed = await conversation.messages({ limit: 80n, direction: SortDirection.Ascending });
        const inboxIds = [...new Set(refreshed.map((m) => m.senderInboxId))];
        const missing = inboxIds.filter((id) => !addressByInboxRef.current.has(id));
        if (missing.length > 0) {
          const states = await client.preferences.getInboxStates(missing);
          for (const state of states) {
            const eth = ethereumAddressFromInboxState(state);
            if (eth) addressByInboxRef.current.set(state.inboxId, eth);
          }
        }
        setMessages(
          refreshed.map((m) => mapDecodedMessage(m, client, addressByInboxRef.current)),
        );
      } catch (error) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        throw error;
      } finally {
        setIsSending(false);
      }
    },
    [client, conversationId],
  );

  useEffect(() => {
    if (!client || !conversationId) {
      setMessages([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let stream: AsyncStreamProxy<DecodedMessage> | null = null;

    const load = async () => {
      setIsLoading(true);
      try {
        await client.conversations.sync();
        const conversation = await client.conversations.getConversationById(conversationId);
        if (!conversation || cancelled) return;

        try {
          const peerInboxId = await (conversation as Dm).peerInboxId();
          const states = await client.preferences.getInboxStates([peerInboxId]);
          const peerAddress = ethereumAddressFromInboxState(states[0]);
          if (peerAddress) addressByInboxRef.current.set(peerInboxId, peerAddress);
        } catch {
          // Not a DM or peer lookup failed — continue loading messages.
        }

        const loaded = await conversation.messages({ limit: 80n, direction: SortDirection.Ascending });
        const inboxIds = [...new Set(loaded.map((m) => m.senderInboxId))];
        const missing = inboxIds.filter((id) => !addressByInboxRef.current.has(id));
        if (missing.length > 0) {
          const states = await client.preferences.getInboxStates(missing);
          for (const state of states) {
            const eth = ethereumAddressFromInboxState(state);
            if (eth) addressByInboxRef.current.set(state.inboxId, eth);
          }
        }

        if (!cancelled) {
          setMessages(loaded.map((m) => mapDecodedMessage(m, client, addressByInboxRef.current)));
        }

        stream = await conversation.stream({
          onValue: (message) => {
            if (cancelled) return;
            if (!addressByInboxRef.current.has(message.senderInboxId) && client.inboxId !== message.senderInboxId) {
              void client.preferences.getInboxStates([message.senderInboxId]).then((states) => {
                const eth = ethereumAddressFromInboxState(states[0]);
                if (eth) addressByInboxRef.current.set(message.senderInboxId, eth);
              });
            }
            const isPeerMessage = Boolean(client.inboxId && message.senderInboxId !== client.inboxId);
            if (isPeerMessage) {
              window.dispatchEvent(new CustomEvent("xmtp:conversations-changed"));
            }
            setMessages((prev) => {
              if (prev.some((m) => m.id === message.id)) return prev;
              return [...prev, mapDecodedMessage(message, client, addressByInboxRef.current)];
            });
          },
        });
      } catch {
        if (!cancelled) setMessages([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
      void stream?.end();
    };
  }, [client, conversationId]);

  return { messages, isLoading, sendMessage, isSending };
}
