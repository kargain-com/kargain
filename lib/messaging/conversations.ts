import type { ConsentState, XmtpSdkClient } from "./adapters/xmtp-adapter";
import {
  ethereumAddressFromInboxState,
  inboxConsentStates,
  listDmsByConsent,
  requestConsentStates,
  syncConversationsAndMessages,
  truncatePreview,
} from "./adapters/xmtp-adapter";
import { applyConsentCutover } from "./consent-cutover";
import {
  filterRenderableUserMessages,
  isRenderableUserMessage,
  userMessageBody,
} from "./message-content";
import { applyRelationshipAllow } from "./relationship-allow";

export type ConversationSummary = {
  id: string;
  peerAddress: string;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
};

type DmConversation = Awaited<ReturnType<typeof listDmsByConsent>>[number];

async function unreadFromProtocolReadState(
  client: XmtpSdkClient,
  dm: DmConversation,
): Promise<number> {
  if (!client.inboxId) return 0;
  const times = await dm.lastReadTimes();
  const ownReadNs = times.get(client.inboxId);
  const options =
    ownReadNs !== undefined
      ? { sentAfterNs: ownReadNs, excludeSenderInboxIds: [client.inboxId] }
      : { excludeSenderInboxIds: [client.inboxId] };
  // Prefer listing + filter: countMessages includes protocol commits.
  const recent = await dm.messages(options);
  return filterRenderableUserMessages(recent).length;
}

async function lastRenderablePreview(
  dm: DmConversation,
): Promise<{ text: string | null; at: Date | null }> {
  const last = await dm.lastMessage();
  if (last && isRenderableUserMessage(last)) {
    return {
      text: truncatePreview(userMessageBody(last)),
      at: last.sentAt ?? null,
    };
  }
  // Walk recent history for the last user-visible message (skip protocol events).
  // Descending = 1 (wasm SortDirection) — avoids requiring the SDK module here.
  const recent = await dm.messages({ limit: 40n, direction: 1 });
  const renderable = filterRenderableUserMessages(recent);
  const tip = renderable[0];
  if (!tip) return { text: null, at: null };
  return {
    text: truncatePreview(userMessageBody(tip)),
    at: tip.sentAt ?? null,
  };
}

export async function buildConversationSummary(
  client: XmtpSdkClient,
  dm: DmConversation,
  inboxStateByInboxId: Map<
    string,
    { accountIdentifiers: Array<{ identifier: string; identifierKind: number }> }
  >,
): Promise<ConversationSummary> {
  const peerInboxId = await dm.peerInboxId();
  const peerAddress =
    ethereumAddressFromInboxState(inboxStateByInboxId.get(peerInboxId)) ?? peerInboxId;

  const { text: lastMessage, at: lastMessageAt } = await lastRenderablePreview(dm);
  const unreadCount = await unreadFromProtocolReadState(client, dm);

  return {
    id: dm.id,
    peerAddress,
    lastMessage,
    lastMessageAt,
    unreadCount,
  };
}

export function sortConversationSummaries(
  summaries: ConversationSummary[],
): ConversationSummary[] {
  return [...summaries].sort((a, b) => {
    const aTime = a.lastMessageAt?.getTime() ?? 0;
    const bTime = b.lastMessageAt?.getTime() ?? 0;
    return bTime - aTime;
  });
}

export function sumUnreadCounts(summaries: ConversationSummary[]): number {
  return summaries.reduce((sum, conversation) => sum + conversation.unreadCount, 0);
}

async function summariesForConsent(
  client: XmtpSdkClient,
  consentStates: ConsentState[],
): Promise<ConversationSummary[]> {
  const dms = await listDmsByConsent(client, consentStates);
  const peerInboxIds = await Promise.all(dms.map((dm) => dm.peerInboxId()));
  const uniquePeerIds = [...new Set(peerInboxIds)];
  const inboxStates =
    uniquePeerIds.length > 0
      ? await client.preferences.getInboxStates(uniquePeerIds)
      : [];
  const inboxStateByInboxId = new Map(
    inboxStates.map((state) => [state.inboxId, state] as const),
  );

  const summaries = await Promise.all(
    dms.map((dm) => buildConversationSummary(client, dm, inboxStateByInboxId)),
  );
  return sortConversationSummaries(summaries);
}

/**
 * Load summaries for one consent partition. Syncs Allowed+Unknown first.
 * Inbox callers pass Allowed; Requests pass Unknown.
 */
export async function loadConversationSummaries(
  client: XmtpSdkClient,
  options: { consentStates: ConsentState[] },
): Promise<ConversationSummary[]> {
  await syncConversationsAndMessages(client);
  return summariesForConsent(client, options.consentStates);
}

/**
 * Sync once, optionally apply cutover + relationship allow, then list both partitions.
 */
export async function loadConsentPartitionedSummaries(
  client: XmtpSdkClient,
  opts: {
    userAddress: `0x${string}` | null;
    applyCutoverAndRelationship: boolean;
  },
): Promise<{
  conversations: ConversationSummary[];
  requestConversations: ConversationSummary[];
}> {
  await syncConversationsAndMessages(client);

  if (opts.applyCutoverAndRelationship) {
    await applyConsentCutover(client);
    if (opts.userAddress) {
      await applyRelationshipAllow(client, opts.userAddress);
    }
  }

  const [conversations, requestConversations] = await Promise.all([
    summariesForConsent(client, inboxConsentStates()),
    summariesForConsent(client, requestConsentStates()),
  ]);
  return { conversations, requestConversations };
}
