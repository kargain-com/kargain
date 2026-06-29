import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  clearMessagingDisabledLocally,
  clearOptedIn,
  hasOptedIn,
  isMessagingDisabledLocally,
  setMessagingDisabledLocally,
  setOptedIn,
} from "../lib/xmtp/messaging-preferences.ts";

const ADDRESS = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1";

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
      clear: () => {
        memory.clear();
      },
    },
  });
});

afterEach(() => {
  memory.clear();
});

describe("messaging-preferences", () => {
  it("tracks opt-in per address", () => {
    assert.equal(hasOptedIn(ADDRESS), false);
    setOptedIn(ADDRESS);
    assert.equal(hasOptedIn(ADDRESS), true);
    assert.equal(hasOptedIn("0x0000000000000000000000000000000000000001"), false);
    clearOptedIn(ADDRESS);
    assert.equal(hasOptedIn(ADDRESS), false);
  });

  it("normalizes address casing for opt-in", () => {
    setOptedIn(ADDRESS.toLowerCase());
    assert.equal(hasOptedIn(ADDRESS.toUpperCase()), true);
  });

  it("tracks local disabled flag per address", () => {
    assert.equal(isMessagingDisabledLocally(ADDRESS), false);
    setMessagingDisabledLocally(ADDRESS);
    assert.equal(isMessagingDisabledLocally(ADDRESS), true);
    clearMessagingDisabledLocally(ADDRESS);
    assert.equal(isMessagingDisabledLocally(ADDRESS), false);
  });
});
