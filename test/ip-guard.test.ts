import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { __testing } from "../lib/lightning/guarded-fetch.ts";
import {
  assertResolvedAddressesAllowed,
  ForbiddenAddressError,
  isForbiddenIp,
} from "../lib/lightning/ip-guard.ts";

const { createPinnedLookup } = __testing;

type ResolvedEntry = { address: string; family: number };

function runPinnedLookup(
  resolved: ResolvedEntry[],
  opts?: { requestAll?: boolean; err?: NodeJS.ErrnoException | null },
): Promise<{
  err: Error | NodeJS.ErrnoException | null;
  address: string | ResolvedEntry[] | null;
  family?: number;
}> {
  const lookup = createPinnedLookup((_hostname, _options, callback) => {
    callback(opts?.err ?? null, resolved);
  });

  const requestOptions = opts?.requestAll ? { all: true as const } : {};

  return new Promise((resolve) => {
    lookup("example.com", requestOptions, (lookupErr, result, family) => {
      if (Array.isArray(result)) {
        resolve({ err: lookupErr, address: result, family });
        return;
      }
      resolve({ err: lookupErr, address: result ?? null, family });
    });
  });
}

describe("isForbiddenIp fail-closed contract", () => {
  it("treats IPv6 address with family 4 as forbidden", () => {
    assert.equal(isForbiddenIp("::1", 4), true);
    assert.equal(isForbiddenIp("fe80::1", 4), true);
  });

  it("treats IPv4 address with family 6 as forbidden", () => {
    assert.equal(isForbiddenIp("127.0.0.1", 6), true);
    assert.equal(isForbiddenIp("1.1.1.1", 6), true);
  });

  it("treats unparseable input as forbidden for both families", () => {
    assert.equal(isForbiddenIp("garbage", 4), true);
    assert.equal(isForbiddenIp("garbage", 6), true);
  });
});

describe("isForbiddenIp IPv4 boundaries", () => {
  const cases: Array<{ allowed: string; forbidden: string; label: string }> = [
    { label: "0.0.0.0/8", allowed: "1.0.0.1", forbidden: "0.0.0.1" },
    { label: "10.0.0.0/8", allowed: "11.0.0.1", forbidden: "10.0.0.1" },
    { label: "100.64.0.0/10", allowed: "100.63.255.255", forbidden: "100.64.0.0" },
    { label: "127.0.0.0/8", allowed: "128.0.0.1", forbidden: "127.0.0.1" },
    { label: "169.254.0.0/16", allowed: "169.253.255.255", forbidden: "169.254.0.1" },
    { label: "172.16.0.0/12", allowed: "172.15.255.255", forbidden: "172.16.0.0" },
    { label: "192.0.0.0/24", allowed: "192.0.1.1", forbidden: "192.0.0.1" },
    { label: "192.0.2.0/24", allowed: "192.0.3.1", forbidden: "192.0.2.1" },
    { label: "192.168.0.0/16", allowed: "192.169.0.1", forbidden: "192.168.0.1" },
    { label: "198.18.0.0/15", allowed: "198.17.255.255", forbidden: "198.18.0.1" },
    { label: "198.51.100.0/24", allowed: "198.51.101.1", forbidden: "198.51.100.1" },
    { label: "203.0.113.0/24", allowed: "203.0.114.1", forbidden: "203.0.113.1" },
    { label: "224.0.0.0/4", allowed: "223.255.255.255", forbidden: "224.0.0.1" },
    { label: "240.0.0.0/4", allowed: "223.255.255.255", forbidden: "240.0.0.1" },
    { label: "255.255.255.255", allowed: "223.255.255.255", forbidden: "255.255.255.255" },
  ];

  for (const { allowed, forbidden, label } of cases) {
    it(`${label}: allows ${allowed}`, () => {
      assert.equal(isForbiddenIp(allowed, 4), false);
    });

    it(`${label}: forbids ${forbidden}`, () => {
      assert.equal(isForbiddenIp(forbidden, 4), true);
    });
  }

  it("allows public IPv4 addresses", () => {
    assert.equal(isForbiddenIp("1.1.1.1", 4), false);
    assert.equal(isForbiddenIp("8.8.8.8", 4), false);
  });
});

describe("isForbiddenIp IPv6 boundaries", () => {
  it("forbids loopback and link-local", () => {
    assert.equal(isForbiddenIp("::1", 6), true);
    assert.equal(isForbiddenIp("fe80::1", 6), true);
  });

  it("forbids unspecified and unique-local prefixes", () => {
    assert.equal(isForbiddenIp("::", 6), true);
    assert.equal(isForbiddenIp("fd12:3456:789a:1::1", 6), true);
  });

  it("forbids multicast prefix", () => {
    assert.equal(isForbiddenIp("ff02::1", 6), true);
  });

  it("allows public IPv6 addresses", () => {
    assert.equal(isForbiddenIp("2606:4700::1111", 6), false);
  });
});

describe("isForbiddenIp IPv4-mapped IPv6", () => {
  it("forbids mapped loopback", () => {
    assert.equal(isForbiddenIp("::ffff:127.0.0.1", 6), true);
  });

  it("allows mapped public IPv4", () => {
    assert.equal(isForbiddenIp("::ffff:1.1.1.1", 6), false);
  });

  it("forbids mapped private IPv4 in hex form", () => {
    assert.equal(isForbiddenIp("::ffff:c0a8:0101", 6), true);
  });
});

describe("assertResolvedAddressesAllowed", () => {
  it("throws on empty list", () => {
    assert.throws(() => assertResolvedAddressesAllowed([]), ForbiddenAddressError);
  });

  it("passes when all addresses are allowed", () => {
    assert.doesNotThrow(() =>
      assertResolvedAddressesAllowed([{ address: "1.1.1.1", family: 4 }]),
    );
  });

  it("throws when any address is forbidden", () => {
    assert.throws(
      () =>
        assertResolvedAddressesAllowed([
          { address: "1.1.1.1", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ]),
      ForbiddenAddressError,
    );
  });

  it("throws on unrecognized family", () => {
    assert.throws(
      () => assertResolvedAddressesAllowed([{ address: "1.1.1.1", family: 10 }]),
      ForbiddenAddressError,
    );
    assert.throws(
      () => assertResolvedAddressesAllowed([{ address: "1.1.1.1", family: 0 }]),
      ForbiddenAddressError,
    );
  });
});

describe("createPinnedLookup", () => {
  it("rejects forbidden resolved addresses", async () => {
    const result = await runPinnedLookup([{ address: "127.0.0.1", family: 4 }]);
    assert.ok(result.err);
    assert.equal(result.err instanceof ForbiddenAddressError, true);
  });

  it("passes allowed IPv4 with family passthrough", async () => {
    const result = await runPinnedLookup([{ address: "1.1.1.1", family: 4 }]);
    assert.equal(result.err, null);
    assert.equal(result.address, "1.1.1.1");
    assert.equal(result.family, 4);
  });

  it("rejects single-address IPv6 forbidden", async () => {
    for (const address of ["::1", "fe80::1"]) {
      const result = await runPinnedLookup([{ address, family: 6 }]);
      assert.ok(result.err, address);
      assert.equal(result.err instanceof ForbiddenAddressError, true, address);
    }
  });

  it("passes single-address IPv6 public with family passthrough", async () => {
    const result = await runPinnedLookup([{ address: "2606:4700::1111", family: 6 }]);
    assert.equal(result.err, null);
    assert.equal(result.address, "2606:4700::1111");
    assert.equal(result.family, 6);
  });

  it("returns validated array when caller requests all", async () => {
    const allowed = [
      { address: "1.1.1.1", family: 4 },
      { address: "8.8.8.8", family: 4 },
    ];
    const result = await runPinnedLookup(allowed, { requestAll: true });
    assert.equal(result.err, null);
    assert.deepEqual(result.address, allowed);
  });
});
