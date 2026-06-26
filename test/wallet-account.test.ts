import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canInitializeMessaging,
  classifyBytecode,
  explorerAddressUrl,
  isMessageablePeer,
  isProtocolAddress,
  messagingWalletError,
} from "../lib/web3/wallet-account.ts";

const DEPLOYER = "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77" as const;

describe("classifyBytecode", () => {
  it("classifies clean EOA", () => {
    assert.equal(classifyBytecode("0x"), "eoa");
    assert.equal(classifyBytecode("0x0"), "eoa");
    assert.equal(classifyBytecode(null), "eoa");
  });

  it("classifies EIP-7702 delegated account", () => {
    assert.equal(classifyBytecode("0xef0100abcdef"), "eip7702");
  });

  it("classifies contract account", () => {
    assert.equal(classifyBytecode("0x6001600052"), "contract");
  });
});

describe("isProtocolAddress", () => {
  it("flags marketplace escrow on Base Sepolia", () => {
    assert.equal(
      isProtocolAddress("0x4FC74e0B7eE0A741707A553D43Efff68126D198B", 84532),
      true,
    );
  });

  it("does not flag arbitrary EOA", () => {
    assert.equal(
      isProtocolAddress("0xcfe194fea9727bD04dA8F78c2362680986e02dF1", 84532),
      false,
    );
  });

  it("does not flag deployer / timelock-config address", () => {
    assert.equal(isProtocolAddress(DEPLOYER, 84532), false);
    assert.equal(isMessageablePeer(DEPLOYER, 84532), true);
  });
});

describe("isMessageablePeer", () => {
  it("rejects protocol addresses", () => {
    assert.equal(
      isMessageablePeer("0x4FC74e0B7eE0A741707A553D43Efff68126D198B", 84532),
      false,
    );
  });

  it("allows normal addresses", () => {
    assert.equal(
      isMessageablePeer("0xcfe194fea9727bD04dA8F78c2362680986e02dF1", 84532),
      true,
    );
  });
});

describe("messagingWalletError", () => {
  it("returns null for EOA and EIP-7702", () => {
    assert.equal(messagingWalletError("eoa"), null);
    assert.equal(messagingWalletError("eip7702"), null);
  });

  it("returns message for contract accounts", () => {
    assert.ok(messagingWalletError("contract"));
  });
});

describe("canInitializeMessaging", () => {
  it("allows EOA and EIP-7702", () => {
    assert.equal(canInitializeMessaging("eoa"), true);
    assert.equal(canInitializeMessaging("eip7702"), true);
  });

  it("blocks contract accounts", () => {
    assert.equal(canInitializeMessaging("contract"), false);
  });
});

describe("explorerAddressUrl", () => {
  it("builds Base Sepolia explorer link", () => {
    const url = explorerAddressUrl(
      84532,
      "0x4FC74e0B7eE0A741707A553D43Efff68126D198B",
    );
    assert.ok(url.includes("sepolia.basescan.org"));
    assert.ok(url.includes("0x4FC74e0B7eE0A741707A553D43Efff68126D198B"));
  });
});
