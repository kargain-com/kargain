import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { commercialActive } from "../lib/web3/commercial-active";
import {
  BRIDGE_HUB_CHAIN_ID,
  BRIDGE_SPOKE_CHAIN_ID,
  EID_BY_CHAIN,
  bridgeCounterpartChainId,
  bridgeDstEid,
  bridgeTokenAddress,
} from "../lib/web3/bridge/bridge-config";

describe("EID_BY_CHAIN", () => {
  it("maps hub and spoke to LayerZero EIDs", () => {
    assert.equal(EID_BY_CHAIN[BRIDGE_HUB_CHAIN_ID], 40245);
    assert.equal(EID_BY_CHAIN[BRIDGE_SPOKE_CHAIN_ID], 40161);
  });
});

describe("bridgeCounterpartChainId", () => {
  it("star counterparts both directions", () => {
    assert.equal(bridgeCounterpartChainId(84532), 11155111);
    assert.equal(bridgeCounterpartChainId(11155111), 84532);
    assert.equal(bridgeCounterpartChainId(1), undefined);
  });
});

describe("bridgeDstEid", () => {
  it("84532 → spoke EID 40161", () => {
    assert.equal(bridgeDstEid(84532), 40161);
  });

  it("11155111 → hub EID 40245", () => {
    assert.equal(bridgeDstEid(11155111), 40245);
  });

  it("unknown src → undefined", () => {
    assert.equal(bridgeDstEid(31337), undefined);
  });
});

describe("bridgeTokenAddress", () => {
  it("matches commercialActive KarPassport per chain", () => {
    const hub = commercialActive(84532);
    const spoke = commercialActive(11155111);
    assert.ok(hub);
    assert.ok(spoke);
    assert.equal(bridgeTokenAddress(84532), hub.karPassport);
    assert.equal(bridgeTokenAddress(11155111), spoke.karPassport);
  });

  it("unknown chain → undefined", () => {
    assert.equal(bridgeTokenAddress(1), undefined);
  });
});
