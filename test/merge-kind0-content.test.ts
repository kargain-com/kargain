import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeKind0Content } from "../lib/nostr/merge-kind0-content.ts";
import type { NostrProfileData } from "../lib/nostr/parse-profile-content.ts";

const STRING_KEYS = ["name", "about", "picture", "website", "lud16"] as const;

describe("mergeKind0Content unknown fields", () => {
  it("preserves unknown fields like nip05", () => {
    const merged = mergeKind0Content(
      { nip05: "user@example.com", name: "Old" },
      { name: "New" },
    );
    assert.equal(merged.nip05, "user@example.com");
    assert.equal(merged.name, "New");
  });
});

describe("mergeKind0Content managed string keys", () => {
  for (const key of STRING_KEYS) {
    it(`sets ${key} with trim`, () => {
      const merged = mergeKind0Content({}, { [key]: "  value  " } as NostrProfileData);
      assert.equal(merged[key], "value");
    });

    it(`clears ${key} on empty string`, () => {
      const merged = mergeKind0Content(
        { [key]: "existing" },
        { [key]: "" } as NostrProfileData,
      );
      assert.equal(merged[key], undefined);
    });

    it(`preserves ${key} when omitted from patch`, () => {
      const existing =
        key === "name"
          ? { name: "kept", about: "Old" }
          : { [key]: "kept", name: "Old" };
      const patch: NostrProfileData =
        key === "name" ? { about: "New" } : { name: "New" };
      const merged = mergeKind0Content(existing, patch);
      assert.equal(merged[key], "kept");
      if (key === "name") {
        assert.equal(merged.about, "New");
      } else {
        assert.equal(merged.name, "New");
      }
    });
  }
});

describe("mergeKind0Content messagesEnabled", () => {
  it("writes messagesEnabled true", () => {
    const merged = mergeKind0Content({}, { messagesEnabled: true });
    assert.equal(merged.messagesEnabled, true);
  });

  it("writes messagesEnabled false", () => {
    const merged = mergeKind0Content({ messagesEnabled: true }, { messagesEnabled: false });
    assert.equal(merged.messagesEnabled, false);
  });

  it("deletes messagesEnabled on invalid value", () => {
    const merged = mergeKind0Content(
      { messagesEnabled: true },
      { messagesEnabled: "yes" as unknown as boolean },
    );
    assert.equal(merged.messagesEnabled, undefined);
  });

  it("preserves messagesEnabled when omitted from patch", () => {
    const merged = mergeKind0Content(
      { messagesEnabled: true, name: "Ada" },
      { name: "Bob" },
    );
    assert.equal(merged.messagesEnabled, true);
    assert.equal(merged.name, "Bob");
  });
});

describe("mergeKind0Content verifierPaymentMethods", () => {
  it("writes deduped array when patch has valid methods", () => {
    const merged = mergeKind0Content(
      { nip05: "user@example.com" },
      { verifierPaymentMethods: ["eth", "usdc", "eth"] },
    );
    assert.deepEqual(merged.verifierPaymentMethods, ["eth", "usdc"]);
    assert.equal(merged.nip05, "user@example.com");
  });

  it("clears methods when patch has empty array", () => {
    const merged = mergeKind0Content(
      { verifierPaymentMethods: ["eth"] },
      { verifierPaymentMethods: [] },
    );
    assert.equal(merged.verifierPaymentMethods, undefined);
  });

  it("clears methods when patch has only unknown values", () => {
    const merged = mergeKind0Content(
      { verifierPaymentMethods: ["eth"] },
      { verifierPaymentMethods: ["bitcoin" as "eth"] },
    );
    assert.equal(merged.verifierPaymentMethods, undefined);
  });

  it("preserves methods when omitted from patch", () => {
    const merged = mergeKind0Content(
      { verifierPaymentMethods: ["lightning"], name: "Old" },
      { name: "New" },
    );
    assert.deepEqual(merged.verifierPaymentMethods, ["lightning"]);
    assert.equal(merged.name, "New");
  });

  it("drops unknown values and keeps known", () => {
    const merged = mergeKind0Content(
      {},
      { verifierPaymentMethods: ["bitcoin" as "eth", "usdc"] },
    );
    assert.deepEqual(merged.verifierPaymentMethods, ["usdc"]);
  });
});
