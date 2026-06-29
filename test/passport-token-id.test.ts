import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatKarPassportTitle,
  formatPassportShortLabel,
  formatPassportTitle,
  parsePassportTokenId,
  truncatePassportTokenId,
} from "../lib/passport/passport-token-id.ts";

const BASE_SEPOLIA = 84532;
const BASE_SEPOLIA_OFFSET = BigInt(BASE_SEPOLIA) << 128n;
const USER_EXAMPLE = "28764749040560770193485982315422230450798592";

describe("parsePassportTokenId", () => {
  it("decodes v2 Base Sepolia offset as local #0", () => {
    const parsed = parsePassportTokenId(USER_EXAMPLE);
    assert.equal(parsed.chainId, BASE_SEPOLIA);
    assert.equal(parsed.localId, 0n);
    assert.equal(parsed.isV2Prefixed, true);
    assert.equal(parsed.full, USER_EXAMPLE);
  });

  it("decodes v2 local sequence #1", () => {
    const tokenId = (BASE_SEPOLIA_OFFSET | 1n).toString();
    const parsed = parsePassportTokenId(tokenId);
    assert.equal(parsed.chainId, BASE_SEPOLIA);
    assert.equal(parsed.localId, 1n);
    assert.equal(parsed.isV2Prefixed, true);
  });

  it("treats small IDs as legacy v1", () => {
    const parsed = parsePassportTokenId("5");
    assert.equal(parsed.chainId, 0);
    assert.equal(parsed.localId, 5n);
    assert.equal(parsed.isV2Prefixed, false);
  });

  it("rejects non-numeric tokenId", () => {
    assert.throws(() => parsePassportTokenId("abc"), /Invalid passport tokenId/);
  });
});

describe("formatPassportShortLabel", () => {
  it("formats v2 with chain name", () => {
    const label = formatPassportShortLabel(USER_EXAMPLE);
    assert.equal(label, "#0 · Base Sepolia");
  });

  it("formats legacy without chain when context missing", () => {
    assert.equal(formatPassportShortLabel("5"), "#5");
  });

  it("formats legacy with context chain", () => {
    assert.equal(formatPassportShortLabel("5", BASE_SEPOLIA), "#5 · Base Sepolia");
  });
});

describe("formatPassportTitle", () => {
  it("prefixes Passport for v2", () => {
    assert.equal(formatPassportTitle(USER_EXAMPLE), "Passport #0 · Base Sepolia");
  });

  it("formats KarPassport title", () => {
    assert.equal(formatKarPassportTitle(USER_EXAMPLE), "KarPassport #0 · Base Sepolia");
  });
});

describe("truncatePassportTokenId", () => {
  it("truncates long decimal IDs", () => {
    assert.equal(
      truncatePassportTokenId(USER_EXAMPLE),
      "28764749…50798592",
    );
  });

  it("returns short IDs unchanged", () => {
    assert.equal(truncatePassportTokenId("5"), "5");
  });
});
