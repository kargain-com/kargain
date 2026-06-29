import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatPassportUploadError } from "../lib/passport/upload-passport-metadata.ts";

describe("formatPassportUploadError", () => {
  it("maps bundler deposit failure to smart-wallet hint", () => {
    const message = formatPassportUploadError(
      new Error("Transaction not sent to any of this bundler"),
    );
    assert.match(message, /could not deposit to Irys storage/i);
    assert.match(message, /EOA/i);
  });

  it("maps user rejection to cancelled message", () => {
    const message = formatPassportUploadError(new Error("User rejected the request"));
    assert.equal(message, "Wallet signature cancelled.");
  });
});
