import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BRIDGE_HUB_CHAIN_ID,
  BRIDGE_SPOKE_CHAIN_ID,
  EID_BY_CHAIN,
  bridgeAdapterAddress,
  bridgeCounterpartChainId,
  bridgeDstEid,
  bridgeTokenAddress,
  resolveBridgeRoute,
} from "../lib/web3/bridge/bridge-config";
import { commercialActive } from "../lib/web3/commercial-active";
import {
  EID_HUB,
  EID_SPOKE,
  loadLayerZeroMetadataSnapshot,
} from "../scripts/lib/layerzero-metadata.js";

describe("EID_BY_CHAIN", () => {
  it("maps hub and spoke to LayerZero EIDs", () => {
    assert.equal(EID_BY_CHAIN[BRIDGE_HUB_CHAIN_ID], 40245);
    assert.equal(EID_BY_CHAIN[BRIDGE_SPOKE_CHAIN_ID], 40161);
  });

  it("matches the committed LayerZero snapshot for commercial chains", () => {
    const snapshot = loadLayerZeroMetadataSnapshot();
    assert.equal(snapshot.chains[EID_HUB]?.eid, EID_BY_CHAIN[BRIDGE_HUB_CHAIN_ID]);
    assert.equal(
      snapshot.chains[EID_SPOKE]?.eid,
      EID_BY_CHAIN[BRIDGE_SPOKE_CHAIN_ID],
    );
  });
});

describe("resolveBridgeRoute", () => {
  it("84532↔11155111 is one hub↔spoke hop", () => {
    const forward = resolveBridgeRoute(BRIDGE_HUB_CHAIN_ID, BRIDGE_SPOKE_CHAIN_ID);
    assert.deepEqual(forward, {
      ok: true,
      hops: [
        {
          srcChainId: BRIDGE_HUB_CHAIN_ID,
          dstChainId: BRIDGE_SPOKE_CHAIN_ID,
        },
      ],
    });
    const back = resolveBridgeRoute(BRIDGE_SPOKE_CHAIN_ID, BRIDGE_HUB_CHAIN_ID);
    assert.deepEqual(back, {
      ok: true,
      hops: [
        {
          srcChainId: BRIDGE_SPOKE_CHAIN_ID,
          dstChainId: BRIDGE_HUB_CHAIN_ID,
        },
      ],
    });
  });

  it("unknown src is a named refusal, not a hub default", () => {
    assert.deepEqual(resolveBridgeRoute(1, BRIDGE_HUB_CHAIN_ID), {
      ok: false,
      reason: "unknown_src",
    });
    assert.deepEqual(resolveBridgeRoute(BRIDGE_HUB_CHAIN_ID, 1), {
      ok: false,
      reason: "unknown_dst",
    });
    assert.deepEqual(
      resolveBridgeRoute(BRIDGE_HUB_CHAIN_ID, BRIDGE_HUB_CHAIN_ID),
      { ok: false, reason: "same_chain" },
    );
  });
});

describe("bridgeAdapterAddress", () => {
  it("returns the gateway for the given chain; unknown is undefined", () => {
    const hub = commercialActive(BRIDGE_HUB_CHAIN_ID);
    const spoke = commercialActive(BRIDGE_SPOKE_CHAIN_ID);
    assert.ok(hub);
    assert.ok(spoke);
    assert.equal(bridgeAdapterAddress(BRIDGE_HUB_CHAIN_ID), hub.bridgeGateway);
    assert.equal(bridgeAdapterAddress(BRIDGE_SPOKE_CHAIN_ID), spoke.bridgeGateway);
    assert.equal(bridgeAdapterAddress(1), undefined);
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
