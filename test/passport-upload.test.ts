import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatPassportUploadError,
  PassportIrysWalletBlockedError,
  uploadPassportToIrys,
} from "../lib/passport/upload-passport-metadata.ts";

function mockProvider(code: string) {
  return {
    request: async (args: { method: string; params?: readonly unknown[] }) => {
      if (args.method === "eth_getCode") return code;
      throw new Error(`unexpected method: ${args.method}`);
    },
  };
}

describe("formatPassportUploadError", () => {
  it("returns wallet-blocked message unchanged", () => {
    const message = formatPassportUploadError(
      new PassportIrysWalletBlockedError(
        "Your wallet uses Smart Account mode (EIP-7702).\nYour ETH balance is safe — no transaction was sent.",
      ),
    );
    assert.match(message, /EIP-7702/);
    assert.match(message, /no transaction was sent/i);
  });
});

describe("uploadPassportToIrys", () => {
  it("throws PassportIrysWalletBlockedError before upload for EIP-7702", async () => {
    globalThis.window = {} as Window & typeof globalThis;

    await assert.rejects(
      () =>
        uploadPassportToIrys({
          newPhotoFiles: [],
          buildMetadata: () => ({ version: "1.1", photos: [] }),
          provider: mockProvider("0xef0100abcdef"),
          address: "0x000000000000000000000000000000000000abcd",
        }),
      (err: unknown) => err instanceof PassportIrysWalletBlockedError,
    );
  });
});
