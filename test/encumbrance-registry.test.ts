import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  deriveEncumbranceRegistry,
  encumbranceRegistryFromSupport,
  isRegisteredEncumbranceSource,
  MAX_ENCUMBRANCE_SOURCES,
} from "../lib/passport/encumbrance-registry.ts";
import type { KeyedEntry } from "../lib/web3/keyed-multicall.ts";
import { mintProtocolOwner } from "../lib/web3/protocol-address.ts";

const NS = 84532;
const A = "0x1111111111111111111111111111111111111111" as const;
const B = "0x2222222222222222222222222222222222222222" as const;

function success(result: unknown): KeyedEntry {
  return { status: "success", result };
}

function failure(): KeyedEntry {
  return { status: "refused", cause: "evm_call_failed", error: new Error("out of range") };
}

describe("deriveEncumbranceRegistry", () => {
  it("is pending when count is unread", () => {
    assert.deepEqual(
      deriveEncumbranceRegistry({
        namespace: NS,
        countEntry: undefined,
        atEntries: [],
      }),
      { status: "pending" },
    );
  });

  it("is pending while count entry is pending", () => {
    assert.deepEqual(
      deriveEncumbranceRegistry({
        namespace: NS,
        countEntry: { status: "pending" },
        atEntries: [],
      }),
      { status: "pending" },
    );
  });

  it("refuses with keyed cause when count read fails", () => {
    assert.deepEqual(
      deriveEncumbranceRegistry({
        namespace: NS,
        countEntry: failure(),
        atEntries: [],
      }),
      { status: "refused", cause: "evm_call_failed" },
    );
  });

  it("builds known sources from count + At entries", () => {
    const registry = deriveEncumbranceRegistry({
      namespace: NS,
      countEntry: success(2n),
      atEntries: [success(A), success(B), failure(), failure()],
    });
    assert.equal(registry.status, "known");
    if (registry.status !== "known") return;
    assert.deepEqual(registry.value, [
      mintProtocolOwner(NS, A),
      mintProtocolOwner(NS, B),
    ]);
  });

  it("caps at MAX_ENCUMBRANCE_SOURCES", () => {
    assert.equal(MAX_ENCUMBRANCE_SOURCES, 8);
    const atEntries = Array.from({ length: 10 }, (_, i) =>
      success(`0x${String(i + 1).padStart(40, "0")}`),
    );
    const registry = deriveEncumbranceRegistry({
      namespace: NS,
      countEntry: success(10n),
      atEntries,
    });
    assert.equal(registry.status, "known");
    if (registry.status !== "known") return;
    assert.equal(registry.value.length, 8);
  });

  it("omits failed At slots inside the count window", () => {
    const registry = deriveEncumbranceRegistry({
      namespace: NS,
      countEntry: success(2n),
      atEntries: [success(A), failure()],
    });
    assert.equal(registry.status, "known");
    if (registry.status !== "known") return;
    assert.deepEqual(registry.value, [mintProtocolOwner(NS, A)]);
  });

  it("encumbranceRegistryFromSupport carries product_owner_owed", () => {
    assert.deepEqual(encumbranceRegistryFromSupport("product_owner_owed"), {
      status: "refused",
      cause: "product_owner_owed",
    });
  });
});

describe("isRegisteredEncumbranceSource", () => {
  it("matches checksum-normalized members", () => {
    const registry = deriveEncumbranceRegistry({
      namespace: NS,
      countEntry: success(1n),
      atEntries: [success(A)],
    });
    assert.equal(isRegisteredEncumbranceSource(registry, A, NS), true);
    assert.equal(isRegisteredEncumbranceSource(registry, B, NS), false);
  });

  it("is false while pending or refused", () => {
    assert.equal(
      isRegisteredEncumbranceSource({ status: "pending" }, A, NS),
      false,
    );
    assert.equal(
      isRegisteredEncumbranceSource(
        { status: "refused", cause: "product_owner_owed" },
        A,
        NS,
      ),
      false,
    );
  });
});

describe("encumbrance registry UI", () => {
  it("passport commerce mounts the registry readout from chain facts", () => {
    const commerce = readFileSync(
      join(process.cwd(), "components/passport/passport-commerce.tsx"),
      "utf8",
    );
    assert.match(commerce, /PassportEncumbranceRegistry/);
    assert.match(commerce, /encumbranceRegistry/);

    const panel = readFileSync(
      join(
        process.cwd(),
        "components/passport/passport-encumbrance-registry.tsx",
      ),
      "utf8",
    );
    assert.match(panel, /Encumbrance sources/);
    assert.match(panel, /Could not answer/);
    assert.match(panel, /unanswerableSource/);
    assert.match(panel, /registry\.status === "pending"/);
    assert.match(panel, /registry\.status === "refused"/);
    assert.match(panel, /commerceFactCauseCopy\(registry\.cause\)/);
    assert.doesNotMatch(panel, /return null;\s*\n\s*\}\s*\n\s*\n\s*const sources/);
  });
});
