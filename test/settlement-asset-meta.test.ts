import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveSettlementAssetMeta } from "../lib/commerce/settlement-asset-meta.ts";

const BASE = 84532;
const USDC_84532 = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ZERO = "0x0000000000000000000000000000000000000000";
const UNKNOWN = "0x1111111111111111111111111111111111111111";

describe("resolveSettlementAssetMeta", () => {
  it("maps native zero to stack nativeUnit (ETH/18 on Base)", () => {
    const meta = resolveSettlementAssetMeta({ chainId: BASE, asset: ZERO });
    assert.equal(meta.identity, "native");
    assert.equal(meta.label, "ETH");
    assert.equal(meta.decimals, 18);
  });

  it("maps empty asset to native", () => {
    const meta = resolveSettlementAssetMeta({ chainId: BASE, asset: null });
    assert.equal(meta.identity, "native");
    assert.equal(meta.label, "ETH");
  });

  it("refuses invented native on non-commercial chainId", () => {
    const meta = resolveSettlementAssetMeta({ chainId: 31337, asset: ZERO });
    assert.equal(meta.identity, "unknown");
    assert.equal(meta.decimals, null);
  });

  it("maps registered USDC to USDC with 6 decimals", () => {
    const meta = resolveSettlementAssetMeta({
      chainId: BASE,
      asset: USDC_84532,
    });
    assert.equal(meta.identity, "usdc");
    assert.equal(meta.label, "USDC");
    assert.equal(meta.decimals, 6);
  });

  it("maps unknown ERC-20 to shortAddress with null decimals", () => {
    const meta = resolveSettlementAssetMeta({
      chainId: BASE,
      asset: UNKNOWN,
    });
    assert.equal(meta.identity, "unknown");
    assert.equal(meta.decimals, null);
    assert.match(meta.label, /^0x1111/);
  });
});
