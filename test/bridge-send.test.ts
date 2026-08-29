import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress, padHex } from "viem";

import { DECLARED_PASSPORT_URI_CEILING_BYTES } from "../lib/web3/declared-uri-ceiling";
import {
  BridgeUriTooLongError,
  buildSendParam,
  encodeLzReceiveExtraOptions,
} from "../lib/web3/bridge/bridge-send";
import {
  ENFORCED_GAS_SEND_AND_COMPOSE,
  requiredLzReceiveGasForUri,
} from "../lib/web3/bridge/lz-receive-gas";

const RECIPIENT = getAddress("0x1111111111111111111111111111111111111111");
const TYPICAL_AR =
  "ar://AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("encodeLzReceiveExtraOptions", () => {
  it("returns non-empty Executor options hex", () => {
    const hex = encodeLzReceiveExtraOptions(ENFORCED_GAS_SEND_AND_COMPOSE);
    assert.ok(hex.startsWith("0x"));
    assert.ok(hex.length > 2);
    assert.notEqual(hex, "0x");
  });
});

describe("buildSendParam", () => {
  it("typical URI → extraOptions for 250k floor", () => {
    const param = buildSendParam({
      dstEid: 40161,
      recipient: RECIPIENT,
      tokenId: 1n,
      tokenUri: TYPICAL_AR,
    });
    assert.equal(param.dstEid, 40161);
    assert.equal(param.to, padHex(RECIPIENT, { size: 32 }));
    assert.equal(param.tokenId, 1n);
    assert.equal(param.composeMsg, "0x");
    assert.equal(param.onftCmd, "0x");
    assert.equal(
      param.extraOptions,
      encodeLzReceiveExtraOptions(ENFORCED_GAS_SEND_AND_COMPOSE),
    );
    assert.notEqual(param.extraOptions, "0x");
  });

  it("URI at declared ceiling → extraOptions for policy gas", () => {
    const tokenUri = `ar://${"b".repeat(DECLARED_PASSPORT_URI_CEILING_BYTES - 5)}`;
    assert.equal(tokenUri.length, DECLARED_PASSPORT_URI_CEILING_BYTES);
    const gasResult = requiredLzReceiveGasForUri(tokenUri);
    assert.equal(gasResult.ok, true);
    if (!gasResult.ok) return;

    const param = buildSendParam({
      dstEid: 40161,
      recipient: RECIPIENT,
      tokenId: 2n,
      tokenUri,
    });
    assert.equal(
      param.extraOptions,
      encodeLzReceiveExtraOptions(gasResult.gas),
    );
  });

  it("over-ceiling URI throws BridgeUriTooLongError", () => {
    const tokenUri = "x".repeat(DECLARED_PASSPORT_URI_CEILING_BYTES + 1);
    assert.throws(
      () =>
        buildSendParam({
          dstEid: 40161,
          recipient: RECIPIENT,
          tokenId: 3n,
          tokenUri,
        }),
      (err: unknown) => {
        assert.ok(err instanceof BridgeUriTooLongError);
        assert.equal(err.reason, "exceeds_uri_ceiling");
        return true;
      },
    );
  });
});
