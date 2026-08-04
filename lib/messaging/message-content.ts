/**
 * Sole owner of which decoded XMTP items are user messages vs protocol/system.
 * Does not require the SDK module for classification (contentType duck-typing).
 */

export const UNSUPPORTED_MESSAGE_COPY = "Unsupported message type";

type ContentTyped = {
  content?: unknown;
  contentType?: { authorityId?: string; typeId?: string } | null;
};

/** Protocol / membership / receipt commits — never bubbles or unread. */
const PROTOCOL_TYPE_IDS = new Set([
  "group_updated",
  "readReceipt",
  "leave_request",
]);

export function isProtocolSystemMessage(message: ContentTyped): boolean {
  const typeId = message.contentType?.typeId;
  return typeof typeId === "string" && PROTOCOL_TYPE_IDS.has(typeId);
}

export function isTextContent(message: ContentTyped): boolean {
  const ct = message.contentType;
  if (ct?.authorityId === "xmtp.org" && ct.typeId === "text") return true;
  // Harness messages without contentType: string body counts as text.
  if (!ct && typeof message.content === "string") return true;
  return false;
}

/** True when this item should appear in the thread / unread / last-preview. */
export function isRenderableUserMessage(message: ContentTyped): boolean {
  return !isProtocolSystemMessage(message);
}

/**
 * Body for a renderable user message. Non-text user content is labeled
 * unsupported — never an ellipsis attributed to a person.
 */
export function userMessageBody(message: ContentTyped): string {
  if (isTextContent(message)) return String(message.content ?? "");
  return UNSUPPORTED_MESSAGE_COPY;
}

export function filterRenderableUserMessages<T extends ContentTyped>(
  messages: T[],
): T[] {
  return messages.filter(isRenderableUserMessage);
}
