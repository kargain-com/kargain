import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { passportStorageUploadHint } from "../lib/web3/wallet-account.ts";

describe("passportStorageUploadHint", () => {
  it("warns smart contract wallets for multiple photos", () => {
    const hint = passportStorageUploadHint({
      kind: "contract",
      photoCount: 2,
      totalBytes: 100_000,
    });
    assert.ok(hint);
    assert.match(hint!, /Smart contract wallets/i);
    assert.match(hint!, /standard MetaMask account/i);
  });

  it("warns smart contract wallets for large single photo", () => {
    const hint = passportStorageUploadHint({
      kind: "contract",
      photoCount: 1,
      totalBytes: 2_000_000,
    });
    assert.ok(hint);
  });

  it("info for large EOA upload", () => {
    const hint = passportStorageUploadHint({
      kind: "eoa",
      photoCount: 5,
      totalBytes: 6_000_000,
    });
    assert.ok(hint);
    assert.match(hint!, /separate Base Sepolia ETH deposit/i);
  });

  it("returns null for small EOA upload", () => {
    const hint = passportStorageUploadHint({
      kind: "eoa",
      photoCount: 2,
      totalBytes: 500_000,
    });
    assert.equal(hint, null);
  });

  it("returns null for single small smart contract photo", () => {
    const hint = passportStorageUploadHint({
      kind: "contract",
      photoCount: 1,
      totalBytes: 500_000,
    });
    assert.equal(hint, null);
  });
});
