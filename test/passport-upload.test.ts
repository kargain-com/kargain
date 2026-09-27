import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UserRejectedRequestError } from "viem";

import { formatPassportUploadError } from "../lib/passport/upload-passport-metadata.ts";
import { walletRejectionCopy } from "../lib/web3/wallet-rejection.ts";

describe("formatPassportUploadError", () => {
  it("maps bundler deposit failure to smart-wallet hint", () => {
    const message = formatPassportUploadError(
      new Error("Transaction not sent to any of this bundler"),
    );
    assert.match(message, /could not deposit to Irys storage/i);
    assert.match(message, /fewer optimized photos/i);
  });

  it("maps user rejection to cancelled message", () => {
    const message = formatPassportUploadError(
      new UserRejectedRequestError(new Error("denied")),
    );
    assert.equal(message, walletRejectionCopy());
  });
});
