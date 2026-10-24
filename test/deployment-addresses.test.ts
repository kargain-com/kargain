import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  evmChainOf,
  evmProtocolAddresses,
  requireEvmCommercialActive,
} from "../lib/web3/commercial-active.ts";
import {
  bridgeGatewayAddress,
  chainlinkEurUsdFeed,
  chainlinkNativeUsdFeed,
  kargainTimelockAddress,
  karPassportAddress,
  karProPassAddress,
  karProStakingAddress,
  usdcAddress,
} from "../lib/web3/deployment-addresses.ts";
import { commerceModeEvmAddress } from "../lib/commerce/mode.ts";
import {
  ETHEREUM_SEPOLIA_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
} from "../lib/web3/sepolia-addresses.ts";
import { kargainChains } from "../lib/web3/supported-chains.ts";
import {
  BASE_SEPOLIA_AT_6C5CEBC,
  ETHEREUM_SEPOLIA_AT_6C5CEBC,
  type BaselineChain,
} from "./fixtures/n2-addresses-at-6c5cebc.ts";

const HUB = requireEvmCommercialActive(84532);
const SPOKE = requireEvmCommercialActive(11155111);

const ENV_KEYS = [
  "NEXT_PUBLIC_KAR_PASSPORT_BY_CHAIN",
  "NEXT_PUBLIC_KAR_PASSPORT_ADDRESS",
  "NEXT_PUBLIC_USDC_BY_CHAIN",
  "NEXT_PUBLIC_KAR_PRO_STAKING_BY_CHAIN",
  "NEXT_PUBLIC_EUR_FEED_ADDRESS",
  "NEXT_PUBLIC_EUR_FEED_BY_CHAIN",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("registry is the only address source", () => {
  it("resolves hub and spoke from the stack rows", () => {
    assert.equal(karPassportAddress(SEPOLIA_CHAIN_ID), HUB.karPassport);
    assert.equal(karPassportAddress(ETHEREUM_SEPOLIA_CHAIN_ID), SPOKE.karPassport);
  });

  it("ids come from the registry rows", () => {
    assert.equal(SEPOLIA_CHAIN_ID, evmChainOf(HUB));
    assert.equal(ETHEREUM_SEPOLIA_CHAIN_ID, evmChainOf(SPOKE));
  });

  it("a non-empty address env map does not change any door", () => {
    const before = karPassportAddress(SEPOLIA_CHAIN_ID);
    const foreign = "0x1111111111111111111111111111111111111111";
    process.env.NEXT_PUBLIC_KAR_PASSPORT_BY_CHAIN = JSON.stringify({
      "84532": foreign,
    });
    process.env.NEXT_PUBLIC_KAR_PASSPORT_ADDRESS = foreign;
    process.env.NEXT_PUBLIC_USDC_BY_CHAIN = JSON.stringify({ "84532": foreign });
    process.env.NEXT_PUBLIC_KAR_PRO_STAKING_BY_CHAIN = JSON.stringify({
      "84532": foreign,
    });
    assert.equal(karPassportAddress(SEPOLIA_CHAIN_ID), before);
    assert.equal(karPassportAddress(SEPOLIA_CHAIN_ID), HUB.karPassport);
    assert.equal(usdcAddress(SEPOLIA_CHAIN_ID), HUB.usdc);
    assert.equal(karProStakingAddress(SEPOLIA_CHAIN_ID), HUB.karProStaking);
  });
});

function assertKeysMatchBaseline(chainId: typeof SEPOLIA_CHAIN_ID, base: BaselineChain) {
  assert.equal(karPassportAddress(chainId), base.keys.karPassport);
  assert.equal(karProPassAddress(chainId), base.keys.karProPass);
  assert.equal(karProStakingAddress(chainId), base.keys.karProStaking);
  assert.equal(usdcAddress(chainId), base.keys.usdc);
  assert.equal(chainlinkNativeUsdFeed(chainId), base.keys.nativeFeed);
  assert.equal(kargainTimelockAddress(chainId), base.keys.timelock);
  assert.equal(bridgeGatewayAddress(chainId), base.keys.bridgeGateway);
  assert.equal(
    commerceModeEvmAddress("fixedPrice", chainId),
    base.keys.fixedPriceConsignment,
  );
  assert.equal(
    commerceModeEvmAddress("ascending", chainId),
    base.keys.ascendingConsignment,
  );
}

describe("doors are byte-identical to the pre-registry values", () => {
  it("84532", () => assertKeysMatchBaseline(SEPOLIA_CHAIN_ID, BASE_SEPOLIA_AT_6C5CEBC));
  it("11155111", () =>
    assertKeysMatchBaseline(ETHEREUM_SEPOLIA_CHAIN_ID, ETHEREUM_SEPOLIA_AT_6C5CEBC));
});

describe("chainlinkEurUsdFeed", () => {
  it("is not_configured on both commercial rows", () => {
    assert.deepEqual(chainlinkEurUsdFeed(SEPOLIA_CHAIN_ID), {
      ok: false,
      cause: "not_configured",
    });
    assert.deepEqual(chainlinkEurUsdFeed(ETHEREUM_SEPOLIA_CHAIN_ID), {
      ok: false,
      cause: "not_configured",
    });
  });

  it("pre-N2 EUR env names do not configure it", () => {
    const planted = "0x1111111111111111111111111111111111111111";
    process.env.NEXT_PUBLIC_EUR_FEED_ADDRESS = planted;
    process.env.NEXT_PUBLIC_EUR_FEED_BY_CHAIN = JSON.stringify({
      "84532": planted,
      "11155111": planted,
    });
    assert.deepEqual(chainlinkEurUsdFeed(SEPOLIA_CHAIN_ID), {
      ok: false,
      cause: "not_configured",
    });
    assert.deepEqual(chainlinkEurUsdFeed(ETHEREUM_SEPOLIA_CHAIN_ID), {
      ok: false,
      cause: "not_configured",
    });
  });
});

describe("historical addresses live on the registry rows", () => {
  it("84532 historical list is byte-identical to the pre-registry list", () => {
    assert.deepEqual([...HUB.historicalDenylist], [...BASE_SEPOLIA_AT_6C5CEBC.historical]);
  });

  it("11155111 historical list is byte-identical to the pre-registry list", () => {
    assert.deepEqual(
      [...SPOKE.historicalDenylist],
      [...ETHEREUM_SEPOLIA_AT_6C5CEBC.historical],
    );
  });

  it("is per-network: spoke does not contain the hub passport", () => {
    const spoke = evmProtocolAddresses(SPOKE).map((a) => a.toLowerCase());
    assert.equal(spoke.includes(HUB.karPassport.toLowerCase()), false);
  });
});

describe("kargainChains write-union", () => {
  it("includes Ethereum Sepolia 11155111", () => {
    assert.ok(kargainChains.some((c) => c.id === ETHEREUM_SEPOLIA_CHAIN_ID));
  });

  it("keeps Base Sepolia 84532", () => {
    assert.ok(kargainChains.some((c) => c.id === SEPOLIA_CHAIN_ID));
  });
});

describe("door argument type", () => {
  it("refuses a bare number at compile time", () => {
    // @ts-expect-error — a bare number is not an Eip155ChainId (TS2345).
    const address = karPassportAddress(84532);
    assert.equal(address, HUB.karPassport);
  });
});
