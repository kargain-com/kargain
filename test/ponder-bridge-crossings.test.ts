/**
 * Pure bridge-crossing helpers — row ids, peer EID extraction, correlation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bridgeCrossingId,
  correlatePassportCounterpart,
  peerLayerZeroEidForDirection,
} from "../lib/bridge/crossing-stream.ts";
import { commercialNamespaceFromLayerZeroEid } from "../lib/web3/commercial-eid-namespace.ts";

describe("ponder-bridge-crossings pure helpers", () => {
  it("bridgeCrossingId is deterministic and lowercase tx hash", () => {
    const tx =
      "0xAbCdEf000000000000000000000000000000000000000000000000000000000001" as const;
    assert.equal(
      bridgeCrossingId({ observingChainId: 84532, txHash: tx, logIndex: 7 }),
      `${84532}-${tx.toLowerCase()}-7`,
    );
  });

  it("peerLayerZeroEidForDirection selects dst on sent and src on received", () => {
    assert.equal(
      peerLayerZeroEidForDirection("sent", { dstEid: 40161, srcEid: 40245 }),
      40161,
    );
    assert.equal(
      peerLayerZeroEidForDirection("received", { dstEid: 40161, srcEid: 40245 }),
      40245,
    );
  });

  it("correlatePassportCounterpart links exactly one tokenId match", () => {
    const linked = correlatePassportCounterpart({
      tokenId: "99",
      candidates: [
        {
          eventName: "PassportBridgeMinted",
          tokenId: "99",
          logIndex: 3,
        },
      ],
    });
    assert.deepEqual(linked, {
      status: "linked",
      eventName: "PassportBridgeMinted",
      logIndex: 3,
    });
  });

  it("correlatePassportCounterpart absent when no tokenId match", () => {
    assert.deepEqual(
      correlatePassportCounterpart({
        tokenId: "99",
        candidates: [
          {
            eventName: "CustodyLockSet",
            tokenId: "100",
            logIndex: 1,
          },
        ],
      }),
      { status: "absent" },
    );
  });

  it("correlatePassportCounterpart ambiguous when multiple same-token candidates", () => {
    assert.deepEqual(
      correlatePassportCounterpart({
        tokenId: "99",
        candidates: [
          {
            eventName: "PassportBridgeMinted",
            tokenId: "99",
            logIndex: 1,
          },
          {
            eventName: "CustodyLockSet",
            tokenId: "99",
            logIndex: 4,
          },
        ],
      }),
      { status: "ambiguous" },
    );
  });

  it("namespace refusal is distinct from counterpart absent", () => {
    const ns = commercialNamespaceFromLayerZeroEid(40168);
    assert.equal(ns.ok, false);
    const counterpart = correlatePassportCounterpart({ tokenId: "1", candidates: [] });
    assert.equal(counterpart.status, "absent");
    assert.notEqual(
      ns.ok === false ? ns.reason : "",
      counterpart.status,
    );
  });
});
