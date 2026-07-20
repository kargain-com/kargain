import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hardhatErrorCode,
  isBytecodeMismatchVerifyError,
  summarizeVerifyError,
} from "../scripts/lib/verify-failure-class.ts";

describe("verify failure classification", () => {
  it("detects HHE80009 bytecode mismatch", () => {
    const sample =
      "HardhatVerifyError: HHE80009: The address provided as argument contains a contract, but its bytecode doesn't match";
    assert.equal(isBytecodeMismatchVerifyError(sample), true);
    assert.equal(hardhatErrorCode(sample), "HHE80009");
  });

  it("detects generic bytecode mismatch prose", () => {
    assert.equal(
      isBytecodeMismatchVerifyError("Compiled contract bytecode does not match"),
      true,
    );
  });

  it("does not classify API errors as bytecode mismatch", () => {
    assert.equal(isBytecodeMismatchVerifyError("Invalid API Key"), false);
  });

  it("does not treat minimal-input retry prose alone as mismatch", () => {
    assert.equal(
      isBytecodeMismatchVerifyError(
        "The initial verification attempt failed using the minimal compiler input.\nTrying again with the full solc input",
      ),
      false,
    );
  });

  it("summarizes first line with Hardhat code when present", () => {
    const summary = summarizeVerifyError("Error: Invalid API Key\nmore detail");
    assert.match(summary, /Invalid API Key/);
  });
});
