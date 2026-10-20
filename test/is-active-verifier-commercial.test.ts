import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  readActiveVerifierMemberships,
  verifierMembershipKey,
} from "../lib/kar-pro/is-active-verifier-commercial.ts";
import { isActiveVerifierOnChain } from "../lib/kar-pro/resolve-pro-showroom.ts";

const WALLET = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;
const WALLET_B = "0x1111111111111111111111111111111111111111" as const;
const WALLET_C = "0x2222222222222222222222222222222222222222" as const;
const SVM_NS = 2000040168;

describe("verifierMembershipKey", () => {
  it("lowercases address in the key", () => {
    assert.equal(
      verifierMembershipKey(84532, "0xCfE194fEa9727bD04dA8F78c2362680986e02dF1"),
      "84532-0xcfe194fea9727bd04da8f78c2362680986e02df1",
    );
  });
});

describe("readActiveVerifierMemberships", () => {
  it("returns success empty map for empty input without reading", async () => {
    let calls = 0;
    const result = await readActiveVerifierMemberships([], {
      readChainActive: async () => {
        calls += 1;
        return [];
      },
    });
    assert.equal(calls, 0);
    assert.equal(result.status, "success");
    if (result.status === "success") {
      assert.equal(result.activeByMembership.size, 0);
    }
  });

  it("does not OR across chains for the same address", async () => {
    const result = await readActiveVerifierMemberships(
      [
        { chainId: 84532, address: WALLET },
        { chainId: 11155111, address: WALLET },
      ],
      {
        readChainActive: async (chainId, addresses) =>
          addresses.map(() => chainId === 84532),
      },
    );
    assert.equal(result.status, "success");
    if (result.status === "success") {
      assert.equal(
        result.activeByMembership.get(verifierMembershipKey(84532, WALLET)),
        true,
      );
      assert.equal(
        result.activeByMembership.get(verifierMembershipKey(11155111, WALLET)),
        false,
      );
    }
  });

  it("only multicalls addresses present on each chain", async () => {
    const seen: Array<{ chainId: number; addresses: string[] }> = [];
    await readActiveVerifierMemberships(
      [
        { chainId: 84532, address: WALLET },
        { chainId: 11155111, address: WALLET_B },
      ],
      {
        readChainActive: async (chainId, addresses) => {
          seen.push({
            chainId,
            addresses: addresses.map((a) => a.toLowerCase()),
          });
          return addresses.map(() => true);
        },
      },
    );
    const hub = seen.find((s) => s.chainId === 84532);
    const spoke = seen.find((s) => s.chainId === 11155111);
    assert.deepEqual(hub?.addresses, [WALLET.toLowerCase()]);
    assert.deepEqual(spoke?.addresses, [WALLET_B.toLowerCase()]);
  });

  it("failure when every chain read returns null", async () => {
    const result = await readActiveVerifierMemberships(
      [{ chainId: 84532, address: WALLET }],
      { readChainActive: async () => null },
    );
    assert.equal(result.status, "failure");
  });

  it("mixed slots omit unread keys — never invent inactive from null", async () => {
    const result = await readActiveVerifierMemberships(
      [
        { chainId: 84532, address: WALLET },
        { chainId: 84532, address: WALLET_B },
        { chainId: 84532, address: WALLET_C },
      ],
      {
        readChainActive: async (_chainId, addresses) => {
          assert.equal(addresses.length, 3);
          return [true, null, false];
        },
      },
    );
    assert.equal(result.status, "success");
    if (result.status !== "success") return;
    assert.equal(result.activeByMembership.size, 2);
    assert.equal(
      result.activeByMembership.get(verifierMembershipKey(84532, WALLET)),
      true,
    );
    assert.equal(
      result.activeByMembership.has(verifierMembershipKey(84532, WALLET_B)),
      false,
    );
    assert.equal(
      result.activeByMembership.get(verifierMembershipKey(84532, WALLET_C)),
      false,
    );
  });
});

describe("isActiveVerifierOnChain", () => {
  it("SVM namespace returns null (unread), never false", async () => {
    const active = await isActiveVerifierOnChain(WALLET, SVM_NS);
    assert.equal(active, null);
  });

  it("failed / missing slot returns null", async () => {
    const unread = await isActiveVerifierOnChain(WALLET, 84532, {
      readChainActive: async () => [null],
    });
    assert.equal(unread, null);

    const failed = await isActiveVerifierOnChain(WALLET, 84532, {
      readChainActive: async () => null,
    });
    assert.equal(failed, null);
  });
});
