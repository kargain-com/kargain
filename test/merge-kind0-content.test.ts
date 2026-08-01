import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Event } from "nostr-tools";

import {
  fetchLatestKind0RawByAuthor,
  mergeKind0Content,
} from "../lib/nostr/merge-kind0-content.ts";
import type { AppEventQueryPool } from "../lib/nostr/app-event-store.ts";
import type { NostrProfileData } from "../lib/nostr/parse-profile-content.ts";
import { KARGAIN_RELAY, NOSTR_RELAYS } from "../lib/nostr/relays.ts";

const STRING_KEYS = ["name", "about", "picture", "website", "lud16"] as const;

type RelayScript =
  | { mode: "eose"; events?: Event[] }
  | { mode: "close-before-eose" }
  | { mode: "ensure-reject" };

function makePool(scripts: {
  defaultScript?: RelayScript;
  byUrl?: Partial<Record<string, RelayScript>>;
}): AppEventQueryPool {
  const defaultScript: RelayScript = scripts.defaultScript ?? { mode: "eose", events: [] };
  const byUrl = scripts.byUrl ?? {};

  return {
    async ensureRelay(url) {
      const script = byUrl[url] ?? defaultScript;
      if (script.mode === "ensure-reject") {
        throw new Error(`ensureRelay failed: ${url}`);
      }
      return {
        subscribe(_filters, params) {
          let closed = false;
          const close = () => {
            if (closed) return;
            closed = true;
            params.onclose?.("closed");
          };
          queueMicrotask(() => {
            if (closed) return;
            if (script.mode === "close-before-eose") {
              close();
              return;
            }
            for (const event of script.events ?? []) {
              params.onevent?.(event);
            }
            params.oneose?.();
          });
          return { close };
        },
      };
    },
  };
}

describe("fetchLatestKind0RawByAuthor coverage", () => {
  it("queries kind:0 by authors pubkey and returns answered content", async () => {
    const pubkey = "aa".repeat(32);
    const pool = makePool({
      defaultScript: {
        mode: "eose",
        events: [
          {
            id: "11".repeat(32),
            pubkey,
            kind: 0,
            created_at: 100,
            content: JSON.stringify({ name: "Ada" }),
            tags: [],
            sig: "cc".repeat(64),
          },
        ],
      },
    });

    const raw = await fetchLatestKind0RawByAuthor(pubkey, { pool });
    assert.equal(raw.status, "answered");
    if (raw.status !== "answered") return;
    assert.equal(raw.content.name, "Ada");
    assert.equal(raw.answeredRelays.length, NOSTR_RELAYS.length);
  });

  it("returns unanswered when no relay reaches EOSE", async () => {
    const pool = makePool({ defaultScript: { mode: "close-before-eose" } });
    const raw = await fetchLatestKind0RawByAuthor("aa".repeat(32), { pool });
    assert.deepEqual(raw, { status: "unanswered", cause: "no-relay-answered" });
  });

  it("includes only relays that reach EOSE in answeredRelays", async () => {
    const pubkey = "bb".repeat(32);
    const pool = makePool({
      defaultScript: {
        mode: "eose",
        events: [
          {
            id: "22".repeat(32),
            pubkey,
            kind: 0,
            created_at: 50,
            content: JSON.stringify({ name: "Bob" }),
            tags: [],
            sig: "cc".repeat(64),
          },
        ],
      },
      byUrl: { [KARGAIN_RELAY]: { mode: "close-before-eose" } },
    });

    const raw = await fetchLatestKind0RawByAuthor(pubkey, { pool });
    assert.equal(raw.status, "answered");
    if (raw.status !== "answered") return;
    assert.ok(!raw.answeredRelays.includes(KARGAIN_RELAY));
    assert.equal(raw.answeredRelays.length, NOSTR_RELAYS.length - 1);
    assert.equal(raw.content.name, "Bob");
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
