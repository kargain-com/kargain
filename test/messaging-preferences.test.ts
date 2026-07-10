import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  clearMessagingDisabledLocally,
  clearNetworkRegisteredCache,
  clearOptedIn,
  getCachedNetworkRegistered,
  hasOptedIn,
  isMessagingDisabledLocally,
  NETWORK_REGISTERED_CACHE_TTL_MS,
  setMessagingDisabledLocally,
  setNetworkRegisteredCache,
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

  it("caches network registration within TTL", () => {
    const now = 1_700_000_000_000;
    assert.equal(getCachedNetworkRegistered(ADDRESS, now), false);
    setNetworkRegisteredCache(ADDRESS, now);
    assert.equal(getCachedNetworkRegistered(ADDRESS, now), true);
    assert.equal(
      getCachedNetworkRegistered(ADDRESS, now + NETWORK_REGISTERED_CACHE_TTL_MS - 1),
      true,
    );
    clearNetworkRegisteredCache(ADDRESS);
    assert.equal(getCachedNetworkRegistered(ADDRESS, now), false);
  });

  it("expires network registration cache after TTL", () => {
    const now = 1_700_000_000_000;
    setNetworkRegisteredCache(ADDRESS, now);
    assert.equal(
      getCachedNetworkRegistered(ADDRESS, now + NETWORK_REGISTERED_CACHE_TTL_MS),
      false,
    );
  });

  it("normalizes address casing for network registration cache", () => {
    const now = 1_700_000_000_000;
    setNetworkRegisteredCache(ADDRESS.toLowerCase(), now);
    assert.equal(getCachedNetworkRegistered(ADDRESS.toUpperCase(), now), true);
  });
});
