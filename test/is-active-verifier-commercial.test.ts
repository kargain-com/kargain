import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isActiveVerifierOnCommercialChains,
  readActiveVerifiersOnCommercialChains,
} from "../lib/kar-pro/is-active-verifier-commercial.ts";
import { COMMERCIAL_ACTIVE } from "../lib/web3/commercial-active.ts";

const WALLET = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;
const WALLET_B = "0x1111111111111111111111111111111111111111" as const;
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

describe("readActiveVerifiersOnCommercialChains", () => {
  it("returns success empty map for empty input without reading", async () => {
    let calls = 0;
    const result = await readActiveVerifiersOnCommercialChains([], {
      readChainActive: async () => {
        calls += 1;
        return [];
      },
    });
    assert.equal(calls, 0);
    assert.equal(result.status, "success");
    if (result.status === "success") {
      assert.equal(result.activeByAddress.size, 0);
    }
  });

  it("ORs hub and spoke across addresses", async () => {
    const result = await readActiveVerifiersOnCommercialChains([WALLET, WALLET_B], {
      readChainActive: async (chainId, addresses) =>
        addresses.map((address) => {
          if (chainId === 84532 && address.toLowerCase() === WALLET.toLowerCase()) {
            return true;
          }
          if (
            chainId === 11155111 &&
            address.toLowerCase() === WALLET_B.toLowerCase()
          ) {
            return true;
          }
          return false;
        }),
    });
    assert.equal(result.status, "success");
    if (result.status === "success") {
      assert.equal(result.activeByAddress.get(WALLET.toLowerCase()), true);
      assert.equal(result.activeByAddress.get(WALLET_B.toLowerCase()), true);
    }
  });

  it("failure when every chain read returns null", async () => {
    const result = await readActiveVerifiersOnCommercialChains([WALLET], {
      readChainActive: async () => null,
    });
    assert.equal(result.status, "failure");
  });

  it("success when one chain fails and the other returns", async () => {
    const result = await readActiveVerifiersOnCommercialChains([WALLET], {
      readChainActive: async (chainId, addresses) => {
        if (chainId === 84532) return null;
        return addresses.map(() => true);
      },
    });
    assert.equal(result.status, "success");
    if (result.status === "success") {
      assert.equal(result.activeByAddress.get(WALLET.toLowerCase()), true);
    }
  });
});
