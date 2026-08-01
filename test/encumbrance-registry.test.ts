import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  deriveEncumbranceRegistry,
  isRegisteredEncumbranceSource,
  MAX_ENCUMBRANCE_SOURCES,
} from "../lib/passport/encumbrance-registry.ts";
import type { KeyedEntry } from "../lib/web3/keyed-multicall.ts";

const A = "0x1111111111111111111111111111111111111111" as const;
const B = "0x2222222222222222222222222222222222222222" as const;

function success(result: unknown): KeyedEntry {
  return { status: "success", result };
}

function failure(): KeyedEntry {
  return { status: "failure", error: new Error("out of range") };
}

describe("deriveEncumbranceRegistry", () => {
  it("is unresolved when count is unread", () => {
    assert.deepEqual(
      deriveEncumbranceRegistry({ countEntry: undefined, atEntries: [] }),
      { sources: [], unresolved: true },
    );
  });

  it("builds an ordered list from count + At entries", () => {
    const registry = deriveEncumbranceRegistry({
      countEntry: success(2n),
      atEntries: [success(A), success(B), failure(), failure()],
    });
    assert.equal(registry.unresolved, false);
    assert.deepEqual(registry.sources, [A, B]);
  });

  it("caps at MAX_ENCUMBRANCE_SOURCES", () => {
    assert.equal(MAX_ENCUMBRANCE_SOURCES, 8);
    const atEntries = Array.from({ length: 10 }, (_, i) =>
      success(`0x${String(i + 1).padStart(40, "0")}`),
    );
    const registry = deriveEncumbranceRegistry({
      countEntry: success(10n),
      atEntries,
    });
    assert.equal(registry.sources.length, 8);
  });

  it("omits failed At slots inside the count window", () => {
    const registry = deriveEncumbranceRegistry({
      countEntry: success(2n),
      atEntries: [success(A), failure()],
    });
    assert.deepEqual(registry.sources, [A]);
  });
});

describe("isRegisteredEncumbranceSource", () => {
  it("matches a registered source and rejects unknowns", () => {
    const registry = deriveEncumbranceRegistry({
      countEntry: success(1n),
      atEntries: [success(A)],
    });
    assert.equal(isRegisteredEncumbranceSource(registry, A), true);
    assert.equal(isRegisteredEncumbranceSource(registry, B), false);
  });

  it("returns false while unresolved", () => {
    assert.equal(
      isRegisteredEncumbranceSource(
        { sources: [], unresolved: true },
        A,
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
  });
});
