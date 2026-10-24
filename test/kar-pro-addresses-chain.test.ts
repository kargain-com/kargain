import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";

import {
  karProPassAddress,
  karProStakingAddress,
} from "../lib/web3/deployment-addresses.ts";
import {
  ETHEREUM_SEPOLIA_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
} from "../lib/web3/sepolia-addresses.ts";
import { requireCommercialActive } from "../lib/web3/commercial-active.ts";

const HUB = SEPOLIA_CHAIN_ID;
const ETH = ETHEREUM_SEPOLIA_CHAIN_ID;

describe("KarPro addresses per commercial chain", () => {
  it("resolves staking and ProPass on hub", () => {
    const stack = requireCommercialActive(HUB);
    assert.equal(karProStakingAddress(HUB), getAddress(stack.karProStaking));
    assert.equal(karProPassAddress(HUB), getAddress(stack.karProPass));
  });

  it("resolves staking and ProPass on spoke", () => {
    const stack = requireCommercialActive(ETH);
    assert.equal(karProStakingAddress(ETH), getAddress(stack.karProStaking));
    assert.equal(karProPassAddress(ETH), getAddress(stack.karProPass));
  });

  it("hub and spoke Pro stacks are distinct", () => {
    assert.notEqual(karProStakingAddress(HUB), karProStakingAddress(ETH));
    assert.notEqual(karProPassAddress(HUB), karProPassAddress(ETH));
  });
});
