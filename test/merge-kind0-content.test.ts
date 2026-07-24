import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchLatestKind0RawByAuthor,
  isMergeBaseUnavailable,
  mergeKind0Content,
} from "../lib/nostr/merge-kind0-content.ts";
import type { AttestedProfileQueryPool } from "../lib/nostr/resolve-attested-profile.ts";
import type { NostrProfileData } from "../lib/nostr/parse-profile-content.ts";

describe("isMergeBaseUnavailable", () => {
  it("returns true when empty and caller expects existing profile", () => {
    assert.equal(isMergeBaseUnavailable({}, true), true);
  });

  it("returns false when empty and caller does not expect existing profile", () => {
    assert.equal(isMergeBaseUnavailable({}, false), false);
  });

  it("returns false when merge base has keys", () => {
    assert.equal(isMergeBaseUnavailable({ name: "Ada" }, true), false);
  });
});

describe("mergeKind0Content attestation", () => {
  it("preserves attestation when omitted from patch", () => {
    const attestation = {
      v: 1 as const,
      sig: "0x1234" as `0x${string}`,
    };
    const merged = mergeKind0Content(
      { attestation, name: "A" },
      { name: "B" },
    );
    assert.deepEqual(merged.attestation, attestation);
    assert.equal(merged.name, "B");
  });
});

const STRING_KEYS = ["name", "about", "picture", "website", "lud16"] as const;

describe("fetchLatestKind0RawByAuthor", () => {
  it("queries kind:0 by authors pubkey only", async () => {
    const pubkey = "aa".repeat(32);
    let capturedFilter: { authors?: string[] } | undefined;

    const pool: AttestedProfileQueryPool = {
      querySync: async (_relays, filter) => {
        capturedFilter = filter as { authors?: string[] };
        return [
          {
            id: "1",
            pubkey,
            content: JSON.stringify({ name: "Ada" }),
            created_at: 100,
            tags: [],
            kind: 0,
            sig: "sig",
          },
        ];
      },
    };

    const raw = await fetchLatestKind0RawByAuthor(pubkey, { pool });
    assert.deepEqual(capturedFilter?.authors, [pubkey]);
    assert.equal(raw.name, "Ada");
  });
});

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

describe("mergeKind0Content location", () => {
  const place = {
    placeId: "osm:R123",
    countryCode: "DE",
    label: "Berlin, Germany",
    city: "Berlin",
  };

  it("writes wire object for complete place", () => {
    const merged = mergeKind0Content({}, { location: place });
    assert.deepEqual(merged.location, {
      placeId: "osm:R123",
      countryCode: "DE",
      label: "Berlin, Germany",
      city: "Berlin",
    });
  });

  it("clears location when patch is null", () => {
    const merged = mergeKind0Content(
      { location: place, name: "Ada" },
      { location: null },
    );
    assert.equal(merged.location, undefined);
    assert.equal(merged.name, "Ada");
  });

  it("preserves location when omitted from patch", () => {
    const merged = mergeKind0Content(
      { location: place, name: "Old" },
      { name: "New" },
    );
    assert.deepEqual(merged.location, place);
    assert.equal(merged.name, "New");
  });

  it("does not invent lat/lng keys", () => {
    const merged = mergeKind0Content({}, { location: place });
    const loc = merged.location as Record<string, unknown>;
    assert.equal("lat" in loc, false);
    assert.equal("lng" in loc, false);
  });
});

