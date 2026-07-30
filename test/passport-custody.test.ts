import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolvePassportCustody } from "../lib/marketplace/passport-custody.ts";

const CHAIN_ID = 84532;
const FIXED_PRICE_CONSIGNMENT = "0x1234567890123456789012345678901234567890" as const;

// commerce modes are fail-closed (undefined) on the live 84532 stack until Nuclear #2
// (see deployment-addresses.test.ts); mock a deployed mode address for this unit test.
process.env.NEXT_PUBLIC_FIXED_PRICE_CONSIGNMENT_BY_CHAIN = JSON.stringify({
  [String(CHAIN_ID)]: FIXED_PRICE_CONSIGNMENT,
});

const SELLER = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;
const OWNER = "0x1111111111111111111111111111111111111111" as const;

describe("resolvePassportCustody", () => {
  it("returns seller as profile address when held by a commerce mode contract", () => {
    const result = resolvePassportCustody({
      chainId: CHAIN_ID,
      passportOwner: FIXED_PRICE_CONSIGNMENT,
      listing: { active: true, seller: SELLER },
    });
    assert.equal(result.isEscrowed, true);
    assert.equal(result.profileAddress.toLowerCase(), SELLER.toLowerCase());
    assert.equal(
      result.custodyAddress?.toLowerCase(),
      FIXED_PRICE_CONSIGNMENT.toLowerCase(),
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
});
