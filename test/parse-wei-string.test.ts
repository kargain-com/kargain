import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseWeiString } from "../lib/web3/parse-wei-string.ts";

describe("parseWeiString", () => {
  it("returns 0n for null, undefined, and empty string", () => {
    assert.equal(parseWeiString(null), 0n);
    assert.equal(parseWeiString(undefined), 0n);
    assert.equal(parseWeiString(""), 0n);
  });

  it("parses zero and positive wei strings", () => {
    assert.equal(parseWeiString("0"), 0n);
    assert.equal(parseWeiString("50000000000000000"), 50_000_000_000_000_000n);
    assert.equal(parseWeiString(0), 0n);
    assert.equal(parseWeiString(50_000_000_000_000_000n), 50_000_000_000_000_000n);
  });

  it("returns 0n for invalid or negative values", () => {
    assert.equal(parseWeiString("not-a-number"), 0n);
    assert.equal(parseWeiString("-1"), 0n);
    assert.equal(parseWeiString(-5n), 0n);
  });
});
