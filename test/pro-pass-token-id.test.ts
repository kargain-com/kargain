import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";

import {
  formatKarProPassTitle,
  formatProPassShortLabel,
  formatProPassTitle,
  parseProPassTokenId,
  proPassTokenIdFromAddress,
} from "../lib/kar-pro/pro-pass-token-id.ts";

const BASE_SEPOLIA = 84532;
const HOLDER = getAddress("0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77");
const USER_EXAMPLE = "1182445522599428026414074299611030795403642014583";

describe("proPassTokenIdFromAddress", () => {
  it("encodes holder address as uint256(uint160)", () => {
    assert.equal(proPassTokenIdFromAddress(HOLDER).toString(), USER_EXAMPLE);
  });
});

describe("parseProPassTokenId", () => {
  it("decodes decimal tokenId to checksummed holder address", () => {
    const parsed = parseProPassTokenId(USER_EXAMPLE);
    assert.equal(parsed.full, USER_EXAMPLE);
    assert.equal(parsed.holderAddress, HOLDER);
  });

  it("round-trips from address", () => {
    const tokenId = proPassTokenIdFromAddress(HOLDER);
    const parsed = parseProPassTokenId(tokenId);
    assert.equal(parsed.holderAddress, HOLDER);
    assert.equal(parsed.full, tokenId.toString());
  });

  it("rejects non-numeric tokenId", () => {
    assert.throws(() => parseProPassTokenId("abc"), /Invalid pro pass tokenId/);
  });
});

describe("formatProPassShortLabel", () => {
  it("formats short address without chain when showChain is false", () => {
    assert.equal(
      formatProPassShortLabel(USER_EXAMPLE, BASE_SEPOLIA, { showChain: false }),
      "#0xcf1E·0b77",
    );
  });

  it("formats short address with chain suffix", () => {
    assert.equal(
      formatProPassShortLabel(USER_EXAMPLE, BASE_SEPOLIA),
      "#0xcf1E·0b77 · Base Sepolia",
    );
  });
});

describe("formatProPassTitle", () => {
  it("prefixes Pass with short label", () => {
    assert.equal(
      formatProPassTitle(USER_EXAMPLE, BASE_SEPOLIA, { showChain: false }),
      "Pass #0xcf1E·0b77",
    );
  });
});

describe("formatKarProPassTitle", () => {
  it("prefixes KarProPass with short label", () => {
    assert.equal(
      formatKarProPassTitle(USER_EXAMPLE, BASE_SEPOLIA, { showChain: false }),
      "KarProPass #0xcf1E·0b77",
    );
  });
});
