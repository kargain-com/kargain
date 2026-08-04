/**
 * P9 cutover: "ever sent a message → Allowed" applied to Unknown history.
 * Resolves at first load via protocol writes — no surviving flag or local mirror.
 */

import type { XmtpSdkClient } from "./adapters/xmtp-adapter";
import {
  listDmsByConsent,
  MessagingConsentState,
  requestConsentStates,
  updateConversationConsent,
} from "./adapters/xmtp-adapter";
import { isRenderableUserMessage } from "./message-content";

/**
 * Pure predicate: Unknown + any outgoing user message ⇒ promote to Allowed.
 * Allowed / Denied are left untouched (idempotent after first resolution).
 */
export function shouldAllowFromEverSent(input: {
  consentState: "unknown" | "allowed" | "denied";
  hasOutgoingUserMessage: boolean;
}): boolean {
  return input.consentState === "unknown" && input.hasOutgoingUserMessage;
}

async function dmHasOutgoingUserMessage(
  dm: {
    messages: (opts?: { limit?: bigint }) => Promise<
      Array<{
        senderInboxId?: string;
        contentType?: { authorityId: string; typeId: string };
        content?: unknown;
      }>
    >;
  },
  ownInboxId: string,
): Promise<boolean> {
  const recent = await dm.messages({ limit: 200n });
  return recent.some(
    (message) =>
      message.senderInboxId === ownInboxId && isRenderableUserMessage(message),
  );
}

/**
 * For each Unknown DM where the local inbox has ever sent a user message,
 * write Allowed on the protocol. Returns how many conversations were promoted.
 *
 * Runs once in effect: after promotion those DMs leave the Unknown set, so a
 * later attach only sees remaining cold Unknown contacts.
 */
export async function applyConsentCutover(client: XmtpSdkClient): Promise<number> {
  const ownInboxId = client.inboxId;
  if (!ownInboxId) return 0;

  const unknown = await listDmsByConsent(client, requestConsentStates());
  let promoted = 0;

  for (const dm of unknown) {
    const hasOutgoing = await dmHasOutgoingUserMessage(dm, ownInboxId);
    if (
      !shouldAllowFromEverSent({
        consentState: "unknown",
        hasOutgoingUserMessage: hasOutgoing,
      })
    ) {
      continue;
    }
    await updateConversationConsent(dm, MessagingConsentState.Allowed);
    promoted += 1;
  }

  return promoted;
}
