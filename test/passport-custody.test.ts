import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { commerceModeAddress, resolveCommerceMode } from "../lib/commerce/mode.ts";
import { resolvePassportCustody } from "../lib/marketplace/passport-custody.ts";

const CHAIN_ID = 84532;
const FIXED_PRICE = commerceModeAddress("fixedPrice", CHAIN_ID);
assert.ok(FIXED_PRICE, "84532 FixedPrice must be live for custody tests");

const SELLER = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;
const OWNER = "0x1111111111111111111111111111111111111111" as const;
/** Devnet-shaped base58 — must not throw through getAddress. */
const SVM_OWNER = "D87okZNVcTr7AAb9mnH6mBTwS9HRryhaq7XNLzUwxKCb";
const SVM_NS = 2000040168;

describe("resolvePassportCustody", () => {
  it("returns seller as profile address when held by a commerce mode contract", () => {
    const result = resolvePassportCustody({
      chainId: CHAIN_ID,
      passportOwner: FIXED_PRICE,
      listing: { active: true, seller: SELLER },
    });
    assert.equal(result.isEscrowed, true);
    assert.equal(result.profileAddress.toLowerCase(), SELLER.toLowerCase());
    assert.equal(
      result.custodyAddress?.toLowerCase(),
      FIXED_PRICE.toLowerCase(),
    );
  });

  it("returns passport owner when not held by a commerce mode contract", () => {
    const result = resolvePassportCustody({
      chainId: CHAIN_ID,
      passportOwner: OWNER,
      listing: null,
    });
    assert.equal(result.isEscrowed, false);
    assert.equal(result.profileAddress.toLowerCase(), OWNER.toLowerCase());
    assert.equal(result.custodyAddress, undefined);
  });

  it("returns passport owner when listing inactive", () => {
    const result = resolvePassportCustody({
      chainId: CHAIN_ID,
      passportOwner: OWNER,
      listing: { active: false, seller: SELLER },
    });
    assert.equal(result.isEscrowed, false);
    assert.equal(result.profileAddress.toLowerCase(), OWNER.toLowerCase());
  });

  it("accepts an SVM base58 owner without throwing (no getAddress on entity)", () => {
    const result = resolvePassportCustody({
      chainId: SVM_NS,
      passportOwner: SVM_OWNER,
      listing: null,
    });
    assert.equal(result.isEscrowed, false);
    assert.equal(result.profileAddress, SVM_OWNER);
    assert.equal(result.custodyAddress, undefined);
  });

  it("SVM mode program id as holder is escrowed when listing active", () => {
    const mode = resolveCommerceMode("fixedPrice", SVM_NS);
    assert.equal(mode.status, "configured");
    if (mode.status !== "configured") return;
    const result = resolvePassportCustody({
      chainId: SVM_NS,
      passportOwner: mode.address,
      listing: { active: true, seller: SVM_OWNER },
    });
    assert.equal(result.isEscrowed, true);
    assert.equal(result.profileAddress, SVM_OWNER);
    assert.equal(result.custodyAddress, mode.address);
  });
});
