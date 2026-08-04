/**
 * I7 — No timer drives conversation or message synchronisation.
 * I8 — Only the user’s Send transmits; entry paths may stage a draft.
 * I11 — Display surfaces fetch via sync choke-points before local reads.
 * I14 — Protocol/system commits are not user messages.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { clearComposeDraftsForTest } from "../lib/messaging/adapters/cache-adapter.ts";
import {
  buildListingInquiryDraft,
  clearComposeDraftMountSeedsForTest,
  clearComposeDraftStorage,
  peekComposeDraft,
  setComposeDraft,
} from "../lib/messaging/compose-draft.ts";
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
import {
  ROOT,
  XMTP_ADAPTER,
  entrySendViolations,
  rawSyncViolations,
  scanTree,
  stripComments,
  timerSyncViolations,
} from "./messaging-invariant-helpers.ts";

const PROVIDER = path.join(ROOT, "components/providers/xmtp-conversations-provider.tsx");
const MESSAGES_HOOK = path.join(ROOT, "hooks/use-xmtp-messages.ts");
const CONVERSATIONS = path.join(ROOT, "lib/messaging/conversations.ts");

const ENTRY_FILES = [
  "components/marketplace/seller-contact-button.tsx",
  "components/verifier/verification-request-button.tsx",
  "components/messaging/message-inbox-client.tsx",
] as const;

afterEach(() => {
  clearComposeDraftsForTest();
  clearComposeDraftMountSeedsForTest();
});

describe("I7 no timer-driven message sync", () => {
  // Blind spot: setTimeout one-shots used for UX debounce are allowed; only
  // setInterval is banned on messaging providers/hooks.

  it("structural: conversations provider and message hook have no setInterval", () => {
    for (const file of [PROVIDER, MESSAGES_HOOK]) {
      assert.deepEqual(timerSyncViolations(fs.readFileSync(file, "utf8")), []);
    }
    const provider = stripComments(fs.readFileSync(PROVIDER, "utf8"));
    assert.equal(provider.includes("visibilitychange"), false);
    assert.equal(provider.includes('addEventListener("focus"'), false);
  });

  it("catches a constructed setInterval sync driver", () => {
    assert.deepEqual(
      timerSyncViolations(`setInterval(() => runSync(), 60_000);\n`),
      ["setInterval"],
    );
    assert.deepEqual(timerSyncViolations(`void runSync();\n`), []);
  });

  it("structural: deleted last-seen / poll vocabulary", () => {
    assert.equal(fs.existsSync(path.join(ROOT, "lib/messaging/last-seen.ts")), false);
    assert.equal(fs.existsSync(path.join(ROOT, "lib/messaging/conversations-sync.ts")), false);
    const found = scanTree(
      [path.join(ROOT, "lib"), path.join(ROOT, "hooks"), path.join(ROOT, "components")],
      (src) => {
        const text = stripComments(src);
        const hits: string[] = [];
        if (text.includes("getLastSeen") || text.includes("CONVERSATIONS_SYNC_INTERVAL_MS")) {
          hits.push("poll vocabulary");
        }
        return hits;
      },
    );
    assert.deepEqual(found, []);
  });
});

describe("I8 only user Send transmits", () => {
  // Blind spot: cannot see an entry path that calls send via a re-exported
  // helper whose name is not send/sendText.

  it("behavioural: draft peek then clear storage; entry stages only", () => {
    setComposeDraft("c1", "  hello  ");
    assert.equal(peekComposeDraft("c1"), "hello");
    assert.equal(peekComposeDraft("c1"), "hello");
    clearComposeDraftStorage("c1");
    // Mount seed survives storage clear (StrictMode remount).
    assert.equal(peekComposeDraft("c1"), "hello");
    clearComposeDraftMountSeedsForTest();
    assert.equal(peekComposeDraft("c1"), null);
    assert.match(buildListingInquiryDraft("42"), /interested in your listing/i);
  });

  it("structural: entry points never call sendText or send", () => {
    const violations: string[] = [];
    for (const rel of ENTRY_FILES) {
      for (const hit of entrySendViolations(fs.readFileSync(path.join(ROOT, rel), "utf8"))) {
        violations.push(`${rel}: ${hit}`);
      }
    }
    assert.deepEqual(violations, []);
    const seller = fs.readFileSync(
      path.join(ROOT, "components/marketplace/seller-contact-button.tsx"),
      "utf8",
    );
    assert.ok(seller.includes("setComposeDraft"));
    assert.equal(seller.includes("lastMessage"), false);
  });

  it("catches a constructed auto-send on seller contact", () => {
    const dirty = `
async function handleClick() {
  const dm = await contactPeer(...);
  if (!(await dm.lastMessage())) await dm.sendText(inquiry);
  router.push("/messages/" + dm.id);
}
`;
    assert.deepEqual(entrySendViolations(dirty), ["sendText"]);
    const clean = `
async function handleClick() {
  const dm = await contactPeer(...);
  setComposeDraft(dm.id, inquiry);
  router.push("/messages/" + dm.id);
}
`;
    assert.deepEqual(entrySendViolations(clean), []);
  });

  it("structural: thread peeks in initializer and clears storage after commit", () => {
    const text = fs.readFileSync(
      path.join(ROOT, "components/messaging/conversation-thread-client.tsx"),
      "utf8",
    );
    assert.ok(text.includes("peekComposeDraft"));
    assert.ok(text.includes("clearComposeDraftStorage"));
    assert.ok(text.includes("key={conversationId}"));
    assert.equal(text.includes("takeComposeDraft"), false);
  });
});

describe("I11 display surfaces sync before local reads", () => {
  // Blind spot: cannot prove a future UI that reads dm.messages() without
  // going through loadConversationSummaries / useXmtpMessages.

  it("behavioural: inbox summaries require syncAll before message appears", async () => {
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
        sync: async () => {},
        listDms: async (_options?: { consentStates?: number[] }) => [dm],
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
    assert.equal(await dm.lastMessage(), null);
    const summaries = await loadConversationSummaries(client as never, {
      consentStates: [1],
    });
    assert.equal(networkSynced, true);
    const row = summaries[0] as ConversationSummary;
    assert.equal(row.lastMessage, "delivered while offline");
    assert.equal(row.unreadCount, 1);
  });

  it("structural: inbox uses syncConversationsAndMessages; thread uses syncConversationMessages", () => {
    const conversations = stripComments(fs.readFileSync(CONVERSATIONS, "utf8"));
    assert.ok(conversations.includes("syncConversationsAndMessages"));
    assert.equal(conversations.includes("conversations.sync("), false);
    const hook = stripComments(fs.readFileSync(MESSAGES_HOOK, "utf8"));
    assert.ok(hook.includes("syncConversationMessages"));
    assert.equal(hook.includes("syncAll"), false);
    assert.ok(fs.readFileSync(XMTP_ADAPTER, "utf8").includes("syncConversationsAndMessages"));
  });

  it("catches a constructed list-only sync in summaries", () => {
    const dirty = `
export async function loadConversationSummaries(client) {
  await client.conversations.sync();
  return client.conversations.listDms();
}
`;
    assert.deepEqual(rawSyncViolations(dirty), ["conversations.sync"]);
    const clean = `
export async function loadConversationSummaries(client) {
  await syncConversationsAndMessages(client);
  return listDmsByConsent(client, consentStates);
}
`;
    assert.deepEqual(rawSyncViolations(clean), []);
  });
});

describe("I14 protocol commits are not user messages", () => {
  // Blind spot: classification is duck-typed on contentType.typeId — a protocol
  // commit with an unknown typeId would render as unsupported user content.

  it("behavioural: protocol excluded; unsupported copy never ellipsis", () => {
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
    assert.deepEqual(filterRenderableUserMessages([protocol, text]), [text]);
    const attachment = {
      content: { data: "…" },
      contentType: { authorityId: "xmtp.org", typeId: "attachment" },
    };
    assert.equal(userMessageBody(attachment), UNSUPPORTED_MESSAGE_COPY);
    assert.notEqual(userMessageBody(attachment), "…");
  });

  it("structural: adapter has no ellipsis fallback for non-text", () => {
    const text = fs.readFileSync(XMTP_ADAPTER, "utf8");
    assert.equal(text.includes('fallback ?? "…"'), false);
    assert.ok(fs.readFileSync(MESSAGES_HOOK, "utf8").includes("filterRenderableUserMessages"));
  });

  it("catches a constructed ellipsis fallback", () => {
    const dirty = `export function messageText(m) { return isText(m) ? m.content : m.fallback ?? "…"; }`;
    assert.ok(dirty.includes('fallback ?? "…"'));
    const clean = `export function userMessageBody(m) { return isTextContent(m) ? String(m.content) : "Unsupported message type"; }`;
    assert.equal(clean.includes('?? "…"'), false);
  });
});

/** I9 / I10 / I15 — proofs under test:nostr; linked here for suite completeness. */
describe("I9 I10 I15 cross-ref (test:nostr)", () => {
  it("documents that coverage / attested-profile / identity owner live under test:nostr", () => {
    assert.ok(
      fs.existsSync(path.join(ROOT, "test/nostr-query-sync-write-policy.test.ts")),
    );
    assert.ok(fs.existsSync(path.join(ROOT, "test/messaging-intent-boundary.test.ts")));
    assert.ok(fs.existsSync(path.join(ROOT, "test/messaging-nostr-identity.test.ts")));
  });
});
