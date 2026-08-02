import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("passport trust banner — Nuclear #4 reset copy", () => {
  it("frames reset as lost verification, not a list block", () => {
    const src = readFileSync(
      join(process.cwd(), "components/passport/passport-trust-banner.tsx"),
      "utf8",
    );
    assert.match(src, /Verification was reset/);
    assert.match(src, /Fixed-price/);
    assert.match(src, /reserve auctions/i);
    assert.doesNotMatch(src, /cannot (list|open a consignment)/i);
  });
});
