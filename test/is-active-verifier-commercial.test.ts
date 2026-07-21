import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isActiveVerifierOnCommercialChains } from "../lib/kar-pro/is-active-verifier-commercial.ts";
import { COMMERCIAL_ACTIVE } from "../lib/web3/commercial-active.ts";

const WALLET = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;
const COMMERCIAL_IDS = Object.keys(COMMERCIAL_ACTIVE)
  .map(Number)
  .sort((a, b) => a - b);

function stubRead(activeOn: ReadonlySet<number>) {
  return async (chainId: number, _wallet: `0x${string}`): Promise<boolean> =>
    activeOn.has(chainId);
}

describe("isActiveVerifierOnCommercialChains", () => {
  it("queries every commercial chain id", async () => {
    const seen: number[] = [];
    await isActiveVerifierOnCommercialChains(WALLET, {
      readIsActiveVerifier: async (chainId) => {
        seen.push(chainId);
        return false;
      },
    });
    assert.deepEqual(seen.sort((a, b) => a - b), COMMERCIAL_IDS);
  });

  it("is true when active only on hub (84532)", async () => {
    assert.equal(
      await isActiveVerifierOnCommercialChains(WALLET, {
        readIsActiveVerifier: stubRead(new Set([84532])),
      }),
      true,
    );
  });

  it("is true when active only on spoke (11155111)", async () => {
    assert.equal(
      await isActiveVerifierOnCommercialChains(WALLET, {
        readIsActiveVerifier: stubRead(new Set([11155111])),
      }),
      true,
    );
  });

  it("is true when active on both commercial chains", async () => {
    assert.equal(
      await isActiveVerifierOnCommercialChains(WALLET, {
        readIsActiveVerifier: stubRead(new Set(COMMERCIAL_IDS)),
      }),
      true,
    );
  });

  it("is false when active on neither", async () => {
    assert.equal(
      await isActiveVerifierOnCommercialChains(WALLET, {
        readIsActiveVerifier: stubRead(new Set()),
      }),
      false,
    );
  });

  it("fail-closed: thrown read on one chain does not flip OR when other is false", async () => {
    assert.equal(
      await isActiveVerifierOnCommercialChains(WALLET, {
        readIsActiveVerifier: async (chainId) => {
          if (chainId === 84532) throw new Error("rpc down");
          return false;
        },
      }),
      false,
    );
  });

  it("OR still true when one chain throws and the other is active", async () => {
    assert.equal(
      await isActiveVerifierOnCommercialChains(WALLET, {
        readIsActiveVerifier: async (chainId) => {
          if (chainId === 84532) throw new Error("rpc down");
          return chainId === 11155111;
        },
      }),
      true,
    );
  });
});
