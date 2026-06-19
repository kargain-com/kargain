import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkWalletForIrysUpload } from "../lib/passport/upload-passport-metadata.ts";
import { checkIrysCompatibility } from "../lib/storage/irys-client.ts";

function mockProvider(code: string | Error) {
  return {
    request: async (args: { method: string; params?: readonly unknown[] }) => {
      if (args.method === "eth_getCode") {
        if (code instanceof Error) throw code;
        return code;
      }
      throw new Error(`unexpected method: ${args.method}`);
    },
  };
}

describe("checkIrysCompatibility", () => {
  it("allows clean EOA (0x)", async () => {
    globalThis.window = {} as Window & typeof globalThis;
    const result = await checkIrysCompatibility(mockProvider("0x"), "0xabc");
    assert.equal(result, null);
  });

  it("allows clean EOA (0x0)", async () => {
    globalThis.window = {} as Window & typeof globalThis;
    const result = await checkIrysCompatibility(mockProvider("0x0"), "0xabc");
    assert.equal(result, null);
  });

  it("blocks EIP-7702 delegated account", async () => {
    globalThis.window = {} as Window & typeof globalThis;
    const result = await checkIrysCompatibility(
      mockProvider("0xef0100abcdef"),
      "0xabc",
    );
    assert.equal(result, "eip7702");
  });

  it("blocks ERC-4337 contract account", async () => {
    globalThis.window = {} as Window & typeof globalThis;
    const result = await checkIrysCompatibility(mockProvider("0x6001600052"), "0xabc");
    assert.equal(result, "contract");
  });

  it("fail-open when eth_getCode throws", async () => {
    globalThis.window = {} as Window & typeof globalThis;
    const result = await checkIrysCompatibility(
      mockProvider(new Error("RPC unavailable")),
      "0xabc",
    );
    assert.equal(result, null);
  });
});

describe("checkWalletForIrysUpload", () => {
  it("returns user message for EIP-7702 with no-tx-sent note", async () => {
    globalThis.window = {} as Window & typeof globalThis;
    const message = await checkWalletForIrysUpload(
      mockProvider("0xef0100abcdef"),
      "0xabc",
    );
    assert.ok(message);
    assert.match(message, /no transaction was sent/i);
    assert.match(message, /EIP-7702/i);
  });
});
