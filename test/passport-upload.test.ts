import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UserRejectedRequestError } from "viem";

import { formatPassportUploadError } from "../lib/passport/upload-passport-metadata.ts";
import {
  IrysDepositRefusal,
  irysDepositCauseCopy,
} from "../lib/storage/irys-deposit.ts";
import { walletRejectionCopy } from "../lib/web3/wallet-rejection.ts";

describe("formatPassportUploadError", () => {
  it("maps deposit_contract_wallet to sole deposit copy", () => {
    const message = formatPassportUploadError(
      new IrysDepositRefusal("deposit_contract_wallet"),
    );
    assert.equal(message, irysDepositCauseCopy("deposit_contract_wallet"));
    assert.match(message, /Smart contract wallets/i);
  });

  it("maps deposit_pending without raw Error.message", () => {
    const message = formatPassportUploadError(
      new IrysDepositRefusal("deposit_pending"),
    );
    assert.equal(message, irysDepositCauseCopy("deposit_pending"));
    assert.match(message, /not be charged twice/i);
  });

  it("maps user rejection to cancelled message", () => {
    const message = formatPassportUploadError(
      new UserRejectedRequestError(new Error("denied")),
    );
    assert.equal(message, walletRejectionCopy());
  });

  it("generic Error is one upload sentence — never err.message", () => {
    const message = formatPassportUploadError(
      new Error("402 error secret internals"),
    );
    assert.equal(message, "Upload failed. Please try again.");
    assert.equal(message.includes("402"), false);
  });
});
