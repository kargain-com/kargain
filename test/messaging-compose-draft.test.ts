/**
 * Navigation / open paths must not transmit messages on the user's behalf.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { clearComposeDraftsForTest } from "../lib/messaging/adapters/cache-adapter.ts";
import {
  buildListingInquiryDraft,
  setComposeDraft,
  takeComposeDraft,
} from "../lib/messaging/compose-draft.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ENTRY_FILES = [
  "components/marketplace/seller-contact-button.tsx",
  "components/verifier/verification-request-button.tsx",
  "components/messaging/message-inbox-client.tsx",
];

afterEach(() => {
  clearComposeDraftsForTest();
});

describe("compose draft owner", () => {
  it("take clears staged draft; empty when absent", () => {
    setComposeDraft("c1", "  hello  ");
    assert.equal(takeComposeDraft("c1"), "hello");
    assert.equal(takeComposeDraft("c1"), null);
  });

  it("listing inquiry draft is factual sentence case", () => {
    const text = buildListingInquiryDraft("42");
    assert.match(text, /interested in your listing/i);
    assert.doesNotMatch(text, /\.\.\./);
  });

  it("compose-draft does not touch browser storage; cache-adapter does", () => {
    const draft = fs.readFileSync(
      path.join(ROOT, "lib/messaging/compose-draft.ts"),
      "utf8",
    );
    const cache = fs.readFileSync(
      path.join(ROOT, "lib/messaging/adapters/cache-adapter.ts"),
      "utf8",
    );
    assert.equal(/\bsessionStorage\b/.test(draft), false);
    assert.equal(/\blocalStorage\b/.test(draft), false);
    assert.ok(draft.includes("writeComposeDraft"));
    assert.ok(draft.includes("takeStoredComposeDraft"));
    assert.ok(cache.includes("writeComposeDraft"));
    assert.ok(cache.includes("messaging:compose-draft:"));
  });
});

describe("open-path send policy", () => {
  it("entry points never call sendText or conversation.send", () => {
    const violations: string[] = [];
    for (const rel of ENTRY_FILES) {
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      if (/\.sendText\s*\(/.test(text) || /\.send\s*\(/.test(text)) {
        violations.push(rel);
      }
    }
    assert.deepEqual(violations, []);
  });

  it("seller and verification stage drafts instead of sending", () => {
    const seller = fs.readFileSync(
      path.join(ROOT, "components/marketplace/seller-contact-button.tsx"),
      "utf8",
    );
    const verification = fs.readFileSync(
      path.join(ROOT, "components/verifier/verification-request-button.tsx"),
      "utf8",
    );
    assert.ok(seller.includes("setComposeDraft"));
    assert.ok(verification.includes("setComposeDraft"));
    assert.equal(seller.includes("lastMessage"), false);
    assert.equal(/\bsendText\b/.test(verification), false);
  });

  it("thread consumes draft via takeComposeDraft", () => {
    const text = fs.readFileSync(
      path.join(ROOT, "components/messaging/conversation-thread-client.tsx"),
      "utf8",
    );
    assert.ok(text.includes("takeComposeDraft"));
  });
});
