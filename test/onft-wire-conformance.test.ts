/**
 * Validator-free ONFT721 wire conformance corpus (plan F / SPEC §I.13.3 / D-16).
 *
 * Fixtures under svm/crates/kargain-onft-codec/fixtures/ are byte-identical with
 * Rust `kargain-onft-codec` unit tests. Encode path uses viem encodePacked +
 * encodeAbiParameters (same shape as KarPassportBridgeGateway / ONFT721MsgCodec).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { getAddress, padHex } from "viem";

import {
  abiEncodeString,
  bytesEqual,
  decodeOnftMessage,
  encodeOnftMessage,
  evmAddressToSendTo,
  hexToUint8Array,
  messageWithComposeExtension,
  SENDER_BYTES,
  tokenIdFromParts,
  uint8ArrayToHex,
  uriFailClosed,
} from "../lib/web3/bridge/onft-msg-codec";

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../svm/crates/kargain-onft-codec/fixtures",
);

function loadFixture(name: string): Uint8Array {
  const hex = readFileSync(path.join(FIXTURES_DIR, `${name}.hex`), "utf8");
  return hexToUint8Array(hex);
}

const TYPICAL_URI = "ar://typical-pointer";
const URI_731 = `ar://${"x".repeat(731 - 5)}`;
const SEND_TO_FULL = hexToUint8Array("ab".repeat(32));
const EVM_ADDR = getAddress("0x1111111111111111111111111111111111111111");
const SEND_TO_EVM = evmAddressToSendTo(EVM_ADDR);
const TID_84532 = tokenIdFromParts(84532n, 1n);
const TID_SOL = tokenIdFromParts(2_000_040_168n, 7n);

describe("onft wire conformance — positive encode/decode", () => {
  it("typical ar:// pointer (84532 namespace, full 32-byte sendTo)", () => {
    assert.equal(TYPICAL_URI.length > 5, true);
    const { message, hasCompose } = encodeOnftMessage(
      SEND_TO_FULL,
      TID_84532,
      abiEncodeString(TYPICAL_URI),
    );
    assert.equal(hasCompose, true);
    assert.ok(message.length > 64);
    assert.deepEqual(uint8ArrayToHex(message), uint8ArrayToHex(loadFixture("typical_ar_84532")));

    const decoded = decodeOnftMessage(message);
    assert.ok(bytesEqual(decoded.sendTo, SEND_TO_FULL));
    assert.ok(bytesEqual(decoded.tokenId, TID_84532));
    const uri = uriFailClosed(decoded);
    assert.equal(uri.ok, true);
    if (uri.ok) assert.equal(uri.uri, TYPICAL_URI);
  });

  it("pointer at 731 UTF-8 bytes (Solana namespace, EVM left-padded sendTo)", () => {
    assert.equal(URI_731.length, 731);
    const { message } = encodeOnftMessage(
      SEND_TO_EVM,
      TID_SOL,
      abiEncodeString(URI_731),
    );
    assert.deepEqual(
      uint8ArrayToHex(message),
      uint8ArrayToHex(loadFixture("ceiling_731_solana_ns")),
    );
    const uri = uriFailClosed(decodeOnftMessage(message));
    assert.equal(uri.ok, true);
    if (uri.ok) assert.equal(uri.uri, URI_731);
  });

  it("sendTo = full 32-byte key with non-zero leading bytes", () => {
    assert.notEqual(SEND_TO_FULL[0], 0);
    const { message } = encodeOnftMessage(
      SEND_TO_FULL,
      TID_SOL,
      abiEncodeString(TYPICAL_URI),
    );
    assert.deepEqual(
      uint8ArrayToHex(message),
      uint8ArrayToHex(loadFixture("sendto_full32_sol_ns")),
    );
    const decoded = decodeOnftMessage(message);
    assert.ok(bytesEqual(decoded.sendTo, SEND_TO_FULL));
    assert.ok(bytesEqual(decoded.tokenId, TID_SOL));
  });

  it("sendTo = 20-byte EVM address left-padded", () => {
    assert.deepEqual(
      uint8ArrayToHex(SEND_TO_EVM),
      padHex(EVM_ADDR, { size: 32 }).slice(2),
    );
    assert.equal(SEND_TO_EVM[0], 0);
    assert.equal(SEND_TO_EVM[11], 0);
    const { message } = encodeOnftMessage(
      SEND_TO_EVM,
      TID_84532,
      abiEncodeString(TYPICAL_URI),
    );
    assert.deepEqual(
      uint8ArrayToHex(message),
      uint8ArrayToHex(loadFixture("sendto_evm_padded_84532")),
    );
    const decoded = decodeOnftMessage(message);
    assert.ok(bytesEqual(decoded.sendTo, SEND_TO_EVM));
    assert.ok(bytesEqual(decoded.tokenId, TID_84532));
  });

  it("tokenId namespaces 84532 and 2_000_040_168 (namespace<<128)", () => {
    assert.deepEqual(
      uint8ArrayToHex(TID_84532),
      "00000000000000000000000000014a3400000000000000000000000000000001",
    );
    assert.deepEqual(
      uint8ArrayToHex(TID_SOL),
      uint8ArrayToHex(tokenIdFromParts(2_000_040_168n, 7n)),
    );
    // high 16 bytes = namespace BE
    const ns84532 = BigInt(`0x${uint8ArrayToHex(TID_84532).slice(0, 32)}`);
    const nsSol = BigInt(`0x${uint8ArrayToHex(TID_SOL).slice(0, 32)}`);
    assert.equal(ns84532, 84532n);
    assert.equal(nsSol, 2_000_040_168n);
  });
});

describe("onft wire conformance — compose-extension around SENDER_BYTES", () => {
  for (const len of [31, 32, 33] as const) {
    it(`compose-extension length ${len}`, () => {
      const fixture = loadFixture(`compose_ext_${len}`);
      assert.equal(fixture.length, 64 + len);
      const extension = new Uint8Array(len);
      const built = messageWithComposeExtension(SEND_TO_FULL, TID_84532, extension);
      assert.deepEqual(uint8ArrayToHex(built), uint8ArrayToHex(fixture));

      const decoded = decodeOnftMessage(fixture);
      assert.ok(decoded.compose != null);
      assert.equal(decoded.compose!.length, len);
      const uri = uriFailClosed(decoded);
      if (len <= SENDER_BYTES) {
        assert.equal(uri.ok, false);
        if (!uri.ok) assert.equal(uri.error, "ComposeRequired");
      } else {
        assert.equal(uri.ok, false);
        if (!uri.ok) assert.equal(uri.error, "ComposeUndecodable");
      }
    });
  }
});

describe("onft wire conformance — SVM named negatives (D-16)", () => {
  it("message without compose → ComposeRequired (EVM would use uri=\"\")", () => {
    const { message, hasCompose } = encodeOnftMessage(
      SEND_TO_FULL,
      TID_84532,
      null,
    );
    assert.equal(hasCompose, false);
    assert.equal(message.length, 64);
    assert.deepEqual(uint8ArrayToHex(message), uint8ArrayToHex(loadFixture("no_compose")));

    const uri = uriFailClosed(decodeOnftMessage(message));
    assert.equal(uri.ok, false);
    if (!uri.ok) assert.equal(uri.error, "ComposeRequired");
  });

  it("corrupted compose → ComposeUndecodable", () => {
    const fixture = loadFixture("corrupted_compose");
    assert.ok(fixture.length > 64 + SENDER_BYTES);
    const uri = uriFailClosed(decodeOnftMessage(fixture));
    assert.equal(uri.ok, false);
    if (!uri.ok) assert.equal(uri.error, "ComposeUndecodable");
  });
});
