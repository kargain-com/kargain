import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isOnChainNftOwner,
  isPassportHolder,
  isSameWallet,
  resolveEffectiveOnChainOwner,
} from "../lib/passport/passport-owner.ts";
import { SEPOLIA_ACTIVE } from "../lib/web3/sepolia-addresses.ts";

/** Mode custody stand-in (listed passport held by FixedPrice / Ascending, not a deleted MarketplaceEscrow). */
const MODE_CUSTODY = SEPOLIA_ACTIVE.fixedPriceConsignment!;
const SELLER = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;
const OWNER = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;

describe("passport-owner helpers", () => {
  it("isSameWallet compares case-insensitively", () => {
    assert.equal(isSameWallet(OWNER, OWNER.toLowerCase()), true);
    assert.equal(isSameWallet(OWNER, OTHER), false);
    assert.equal(isSameWallet(null, OWNER), false);
  });

  it("resolveEffectiveOnChainOwner prefers chain over ponder", () => {
    assert.equal(
      resolveEffectiveOnChainOwner(OWNER, SELLER),
      OWNER,
    );
    assert.equal(resolveEffectiveOnChainOwner(undefined, SELLER), SELLER);
    assert.equal(resolveEffectiveOnChainOwner(undefined, undefined), undefined);
  });

  it("isOnChainNftOwner matches wallet to on-chain owner", () => {
    assert.equal(isOnChainNftOwner(OWNER, OWNER), true);
    assert.equal(isOnChainNftOwner(OTHER, OWNER), false);
  });

  it("isPassportHolder uses seller when listed in escrow", () => {
    assert.equal(
      isPassportHolder({
        address: SELLER,
        onChainOwner: MODE_CUSTODY,
        listingActive: true,
        listingSeller: SELLER,
      }),
      true,
    );
    assert.equal(
      isPassportHolder({
        address: OWNER,
        onChainOwner: MODE_CUSTODY,
        listingActive: true,
        listingSeller: SELLER,
      }),
      false,
    );
  });

  it("isPassportHolder uses on-chain owner when not listed", () => {
    assert.equal(
      isPassportHolder({
        address: OWNER,
        onChainOwner: OWNER,
        listingActive: false,
      }),
      true,
    );
    assert.equal(
      isPassportHolder({
        address: OTHER,
        onChainOwner: OWNER,
        listingActive: false,
      }),
      false,
    );
  });

  it("isPassportHolder falls back to ponder owner while chain loads", () => {
    assert.equal(
      isPassportHolder({
        address: OWNER,
        ponderOwner: OWNER,
        listingActive: false,
      }),
      true,
    );
  });

  it("isPassportHolder treats delisted passport as on-chain owner not stale ponder", () => {
    assert.equal(
      isPassportHolder({
        address: SELLER,
        onChainOwner: SELLER,
        ponderOwner: MODE_CUSTODY,
        listingActive: false,
      }),
      true,
    );
    assert.equal(
      isPassportHolder({
        address: SELLER,
        onChainOwner: SELLER,
        ponderOwner: MODE_CUSTODY,
        listingActive: false,
        listingSeller: SELLER,
      }),
      true,
    );
  });
});
