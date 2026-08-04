/**
 * Message sync + content policy: syncAll for inbox, conversation.sync for thread,
 * protocol events excluded, unsupported copy (never ellipsis), no timer polling.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadConversationSummaries,
  type ConversationSummary,
} from "../lib/messaging/conversations.ts";
import {
  UNSUPPORTED_MESSAGE_COPY,
  filterRenderableUserMessages,
  isProtocolSystemMessage,
  isRenderableUserMessage,
  userMessageBody,
} from "../lib/messaging/message-content.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ADAPTER = path.join(ROOT, "lib/messaging/adapters/xmtp-adapter.ts");
const CONVERSATIONS = path.join(ROOT, "lib/messaging/conversations.ts");
const MESSAGES_HOOK = path.join(ROOT, "hooks/use-xmtp-messages.ts");
const PROVIDER = path.join(
  ROOT,
  "components/providers/xmtp-conversations-provider.tsx",
);

const SCAN_DIRS = [
  path.join(ROOT, "app"),
  path.join(ROOT, "components"),
  path.join(ROOT, "hooks"),
  path.join(ROOT, "lib/messaging"),
] as const;

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("message content owner", () => {
  it("excludes protocol system commits from renderable list", () => {
    const protocol = {
      content: "membership",
      contentType: { authorityId: "xmtp.org", typeId: "group_updated" },
    };
    const text = {
      content: "hello",
      contentType: { authorityId: "xmtp.org", typeId: "text" },
    };
    assert.equal(isProtocolSystemMessage(protocol), true);
    assert.equal(isRenderableUserMessage(protocol), false);
    assert.equal(isRenderableUserMessage(text), true);
    assert.deepEqual(filterRenderableUserMessages([protocol, text]), [text]);
  });

  it("unsupported user content uses named copy, never ellipsis", () => {
    const attachment = {
      content: { data: "…" },
      contentType: { authorityId: "xmtp.org", typeId: "attachment" },
    };
    assert.equal(isRenderableUserMessage(attachment), true);
    assert.equal(userMessageBody(attachment), UNSUPPORTED_MESSAGE_COPY);
    assert.notEqual(userMessageBody(attachment), "…");
    assert.doesNotMatch(userMessageBody(attachment), /^\.+$/);
  });

  it("text body is the string content", () => {
    assert.equal(
      userMessageBody({
        content: "hi",
        contentType: { authorityId: "xmtp.org", typeId: "text" },
      }),
      "hi",
    );
  });
});

describe("offline delivery requires syncAll", () => {
  it("recipient local store is empty until syncAll, then inbox shows the message", async () => {
    const inboxId = "recipient-inbox";
    let networkSynced = false;
    const networkText = {
      id: "m1",
      content: "delivered while offline",
      contentType: { authorityId: "xmtp.org", typeId: "text" as const },
      sentAt: new Date("2026-08-01T12:00:00Z"),
      senderInboxId: "sender-inbox",
    };

    const dm = {
      id: "dm-offline",
      peerInboxId: async () => "sender-inbox",
      lastMessage: async () => (networkSynced ? networkText : null),
      lastReadTimes: async () => new Map<string, bigint>(),
      messages: async () => (networkSynced ? [networkText] : []),
    };

    const client = {
      inboxId,
      conversations: {
        syncAll: async () => {
          networkSynced = true;
        },
        // list-only sync must NOT populate messages — proving syncAll is required.
        sync: async () => {
          /* intentionally empty */
        },
        listDms: async () => [dm],
      },
      preferences: {
        getInboxStates: async (ids: string[]) =>
          ids.map((id) => ({
            inboxId: id,
            accountIdentifiers: [
              {
                identifier: "0x1111111111111111111111111111111111111111",
                identifierKind: 0,
              },
            ],
          })),
      },
    };

    // Without syncAll, local reads stay empty (simulate forgotten call).
    assert.equal(networkSynced, false);
    assert.equal(await dm.lastMessage(), null);

    const summaries = await loadConversationSummaries(client as never);
    assert.equal(networkSynced, true);
    assert.equal(summaries.length, 1);
    const row = summaries[0] as ConversationSummary;
    assert.equal(row.lastMessage, "delivered while offline");
    assert.equal(row.unreadCount, 1);
  });
});

describe("sync choke-point policy", () => {
  it("adapter owns syncAll and conversation.sync helpers", () => {
    const text = fs.readFileSync(ADAPTER, "utf8");
    assert.ok(text.includes("export async function syncConversationsAndMessages"));
    assert.ok(text.includes("export async function syncConversationMessages"));
    assert.ok(text.includes("syncAll()"));
    assert.match(text, /syncConversationMessages[\s\S]*conversation\.sync\(\)/);
  });

  it("inbox summaries call syncConversationsAndMessages, not list-only sync", () => {
    const text = stripComments(fs.readFileSync(CONVERSATIONS, "utf8"));
    assert.ok(text.includes("syncConversationsAndMessages"));
    assert.equal(text.includes("conversations.sync("), false);
    assert.equal(text.includes("syncAll("), false);
  });

  it("thread hook uses conversation sync, not syncAll", () => {
    const text = stripComments(fs.readFileSync(MESSAGES_HOOK, "utf8"));
    assert.ok(text.includes("syncConversationMessages"));
    assert.equal(text.includes("syncConversationsAndMessages"), false);
    assert.equal(text.includes("syncAll"), false);
    assert.equal(text.includes("conversations.sync("), false);
  });

  it("raw syncAll / conversations.sync stay inside the adapter choke-point", () => {
    const violations: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        const rel = path.relative(ROOT, file);
        if (rel === "lib/messaging/adapters/xmtp-adapter.ts") continue;
        const text = stripComments(fs.readFileSync(file, "utf8"));
        if (/\.syncAll\s*\(/.test(text)) {
          violations.push(`${rel}: syncAll`);
        }
        if (/conversations\.sync\s*\(/.test(text)) {
          violations.push(`${rel}: conversations.sync`);
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("no timer-driven message sync under messaging providers/hooks", () => {
    const violations: string[] = [];
    for (const file of [
      PROVIDER,
      MESSAGES_HOOK,
      path.join(ROOT, "hooks/use-messaging-session.ts"),
    ]) {
      const text = stripComments(fs.readFileSync(file, "utf8"));
      if (text.includes("setInterval") || text.includes("setTimeout(")) {
        // Allow AbortSignal / sleep helpers only if absent — ban interval polling.
        if (text.includes("setInterval")) {
          violations.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("adapter never defaults non-text to ellipsis", () => {
    const text = fs.readFileSync(ADAPTER, "utf8");
    assert.equal(text.includes('fallback ?? "…"'), false);
    assert.equal(text.includes('?? "…"'), false);
  });

  it("thread maps only renderable user messages", () => {
    const text = fs.readFileSync(MESSAGES_HOOK, "utf8");
    assert.ok(text.includes("filterRenderableUserMessages"));
    assert.ok(text.includes("isRenderableUserMessage"));
    assert.ok(text.includes("userMessageBody"));
  });
});
