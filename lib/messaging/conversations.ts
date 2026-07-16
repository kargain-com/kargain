import type { XmtpSdkClient } from "./adapters/xmtp-adapter";
import {
  dateToSentAfterNs,
  ethereumAddressFromInboxState,
  messageText,
  truncatePreview,
} from "./adapters/xmtp-adapter";
import { getLastSeen } from "./last-seen";

export type ConversationSummary = {
  id: string;
  peerAddress: string;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
};

type DmConversation = Awaited<ReturnType<XmtpSdkClient["conversations"]["listDms"]>>[number];

export async function buildConversationSummary(
  client: XmtpSdkClient,
  dm: DmConversation,
): Promise<ConversationSummary> {
  const peerInboxId = await dm.peerInboxId();
  const inboxStates = await client.preferences.getInboxStates([peerInboxId]);
  const peerAddress =
    ethereumAddressFromInboxState(inboxStates[0]) ?? peerInboxId;

  const last = await dm.lastMessage();
  const lastMessage = last ? truncatePreview(messageText(last)) : null;
  const lastMessageAt = last?.sentAt ?? null;

  const lastSeen = getLastSeen(dm.id);
  let unreadCount = 0;
  if (client.inboxId) {
    const options = lastSeen
      ? { sentAfterNs: dateToSentAfterNs(lastSeen), excludeSenderInboxIds: [client.inboxId] }
      : { excludeSenderInboxIds: [client.inboxId] };
    unreadCount = Number(await dm.countMessages(options));
  }

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

export async function loadConversationSummaries(
  client: XmtpSdkClient,
): Promise<ConversationSummary[]> {
  await client.conversations.sync();
  const dms = await client.conversations.listDms();
  const summaries = await Promise.all(
    dms.map((dm) => buildConversationSummary(client, dm)),
  );
  return sortConversationSummaries(summaries);
}
