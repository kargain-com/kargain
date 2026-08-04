/**
 * Accept / Block / Unblock — protocol consent writes only (P9).
 */

import type { XmtpSdkClient } from "./adapters/xmtp-adapter";
import {
  listDmsByConsent,
  MessagingConsentState,
  deniedConsentStates,
  setConsentStatesByInboxId,
  updateConversationConsent,
} from "./adapters/xmtp-adapter";
import type { ConversationSummary } from "./conversations";
import {
  ethereumAddressFromInboxState,
  truncatePreview,
} from "./adapters/xmtp-adapter";
import {
  filterRenderableUserMessages,
  isRenderableUserMessage,
  userMessageBody,
} from "./message-content";

export async function acceptConversationRequest(
  client: XmtpSdkClient,
  conversationId: string,
): Promise<{ ok: true } | { ok: false }> {
  try {
    const conversation = await client.conversations.getConversationById(conversationId);
    if (!conversation) return { ok: false };
    await updateConversationConsent(conversation, MessagingConsentState.Allowed);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function blockConversation(
  client: XmtpSdkClient,
  conversationId: string,
): Promise<{ ok: true } | { ok: false }> {
  try {
    const conversation = await client.conversations.getConversationById(conversationId);
    if (!conversation) return { ok: false };
    await updateConversationConsent(conversation, MessagingConsentState.Denied);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function unblockPeerByInboxId(
  client: XmtpSdkClient,
  peerInboxId: string,
): Promise<void> {
  // Restore to Unknown so the peer lands in Requests, not the inbox.
  await setConsentStatesByInboxId(client, [
    { inboxId: peerInboxId, state: MessagingConsentState.Unknown },
  ]);
}

export type BlockedPeerSummary = {
  id: string;
  peerInboxId: string;
  peerAddress: string;
  lastMessage: string | null;
};

/** Denied conversations for settings unblock — protocol list only. */
export async function loadBlockedPeerSummaries(
  client: XmtpSdkClient,
): Promise<BlockedPeerSummary[]> {
  const dms = await listDmsByConsent(client, deniedConsentStates());
  const peerInboxIds = await Promise.all(dms.map((dm) => dm.peerInboxId()));
  const uniquePeerIds = [...new Set(peerInboxIds)];
  const inboxStates =
    uniquePeerIds.length > 0
      ? await client.preferences.getInboxStates(uniquePeerIds)
      : [];
  const byInbox = new Map(
    inboxStates.map((state) => [state.inboxId, state] as const),
  );

  const rows: BlockedPeerSummary[] = [];
  for (let i = 0; i < dms.length; i += 1) {
    const dm = dms[i]!;
    const peerInboxId = peerInboxIds[i]!;
    const peerAddress =
      ethereumAddressFromInboxState(byInbox.get(peerInboxId)) ?? peerInboxId;
    const last = await dm.lastMessage();
    let lastMessage: string | null = null;
    if (last && isRenderableUserMessage(last)) {
      lastMessage = truncatePreview(userMessageBody(last));
    } else {
      const recent = await dm.messages({ limit: 40n, direction: 1 });
      const tip = filterRenderableUserMessages(recent)[0];
      if (tip) lastMessage = truncatePreview(userMessageBody(tip));
    }
    rows.push({
      id: dm.id,
      peerInboxId,
      peerAddress,
      lastMessage,
    });
  }
  return rows;
}

export function isRequestConversation(
  requestConversations: ConversationSummary[],
  conversationId: string,
): boolean {
  return requestConversations.some((row) => row.id === conversationId);
}
