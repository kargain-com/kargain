import type { XmtpSdkClient } from "./adapters/xmtp-adapter";
import {
  ethereumAddressFromInboxState,
  messageText,
  truncatePreview,
} from "./adapters/xmtp-adapter";

export type ConversationSummary = {
  id: string;
  peerAddress: string;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
};

type DmConversation = Awaited<ReturnType<XmtpSdkClient["conversations"]["listDms"]>>[number];

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
  return Number(await dm.countMessages(options));
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

  const last = await dm.lastMessage();
  const lastMessage = last ? truncatePreview(messageText(last)) : null;
  const lastMessageAt = last?.sentAt ?? null;
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

/**
 * Load inbox summaries. Inbox states are resolved in one batch for all peers.
 */
export async function loadConversationSummaries(
  client: XmtpSdkClient,
): Promise<ConversationSummary[]> {
  await client.conversations.sync();
  const dms = await client.conversations.listDms();
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
