import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  commercialChainIds,
  fxRateChainId,
  parseOptionalChainParam,
  resolveAuctionsNavChainId,
  resolveCustodyCommerceChainId,
  resolveOriginChainId,
  resolveUrlExpectedChainId,
  resolveWalletCommercialChainId,
  storageEnvChainId,
} from "../lib/web3/chain-context.ts";

describe("parseOptionalChainParam", () => {
  it("returns null for missing / empty / invalid", () => {
    assert.equal(parseOptionalChainParam(undefined), null);
    assert.equal(parseOptionalChainParam(null), null);
    assert.equal(parseOptionalChainParam(""), null);
    assert.equal(parseOptionalChainParam("abc"), null);
    assert.equal(parseOptionalChainParam("0"), null);
    assert.equal(parseOptionalChainParam("-1"), null);
  });

  it("parses positive chain ids", () => {
    assert.equal(parseOptionalChainParam("84532"), 84532);
    assert.equal(parseOptionalChainParam(["11155111"]), 11155111);
  });
});

describe("resolveUrlExpectedChainId", () => {
  it("accepts write-union chains", () => {
    assert.equal(resolveUrlExpectedChainId("84532"), 84532);
    assert.equal(resolveUrlExpectedChainId("11155111"), 11155111);
  });

  it("returns null for missing or non-write-union", () => {
    assert.equal(resolveUrlExpectedChainId(undefined), null);
    assert.equal(resolveUrlExpectedChainId("1"), null);
  });
});

describe("resolveWalletCommercialChainId", () => {
  it("returns commercial wallet chain ids", () => {
    assert.equal(resolveWalletCommercialChainId(84532), 84532);
    assert.equal(resolveWalletCommercialChainId(11155111), 11155111);
  });

  it("returns null for missing or non-commercial — never invents 84532", () => {
    assert.equal(resolveWalletCommercialChainId(undefined), null);
    assert.equal(resolveWalletCommercialChainId(1), null);
    assert.equal(resolveWalletCommercialChainId(Number.NaN), null);
  });
});

describe("resolveCustodyCommerceChainId / resolveOriginChainId", () => {
  it("accepts commercial ids", () => {
    assert.equal(resolveCustodyCommerceChainId(11155111), 11155111);
    assert.equal(resolveOriginChainId(84532), 84532);
  });

  it("returns null for missing / non-commercial — never invents 84532", () => {
    assert.equal(resolveCustodyCommerceChainId(null), null);
    assert.equal(resolveCustodyCommerceChainId(undefined), null);
    assert.equal(resolveCustodyCommerceChainId(1), null);
    assert.equal(resolveOriginChainId(null), null);
    assert.equal(resolveOriginChainId(1), null);
  });
});

describe("resolveAuctionsNavChainId", () => {
  const hasAscending = (id: number) => id === 84532 || id === 11155111;

  it("connected on Eth with ascending mode → Eth (not hub)", () => {
    assert.equal(
      resolveAuctionsNavChainId({
        walletChainId: 11155111,
        isConnected: true,
        hasAscendingMode: hasAscending,
      }),
      11155111,
    );
  });

  it("connected non-commercial → null (not silent hub)", () => {
    assert.equal(
      resolveAuctionsNavChainId({
        walletChainId: 1,
        isConnected: true,
        hasAscendingMode: hasAscending,
      }),
      null,
    );
  });

  it("connected commercial without ascending mode → null", () => {
    assert.equal(
      resolveAuctionsNavChainId({
        walletChainId: 84532,
        isConnected: true,
        hasAscendingMode: () => false,
      }),
      null,
    );
  });

  it("guest → first commercial with ascending mode", () => {
    assert.equal(
      resolveAuctionsNavChainId({
        walletChainId: undefined,
        isConnected: false,
        hasAscendingMode: hasAscending,
      }),
      84532,
    );
  });

  it("guest with no ascending mode anywhere → null", () => {
    assert.equal(
      resolveAuctionsNavChainId({
        walletChainId: undefined,
        isConnected: false,
        hasAscendingMode: () => false,
      }),
      null,
    );
  });
});

describe("commercialChainIds / pins", () => {
  it("lists sorted commercial ids", () => {
    assert.deepEqual(commercialChainIds(), [84532, 11155111]);
  });

  it("fx and storage pins are stable named constants (not commerce invent)", () => {
    assert.equal(fxRateChainId(), 84532);
    assert.equal(storageEnvChainId(), 84532);
  });
});
