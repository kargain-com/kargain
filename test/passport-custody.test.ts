import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolvePassportCustody } from "../lib/marketplace/passport-custody.ts";

const MARKETPLACE = "0x4FC74e0B7eE0A741707A553D43Efff68126D198B" as const;
const SELLER = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;
const OWNER = "0x1111111111111111111111111111111111111111" as const;

describe("resolvePassportCustody", () => {
  it("returns seller as profile address when listed in escrow", () => {
    const result = resolvePassportCustody({
      chainId: 84532,
      passportOwner: MARKETPLACE,
      listing: { active: true, seller: SELLER },
    });
    assert.equal(result.isEscrowed, true);
    assert.equal(result.profileAddress.toLowerCase(), SELLER.toLowerCase());
    assert.equal(result.custodyAddress?.toLowerCase(), MARKETPLACE.toLowerCase());
  });

  it("returns passport owner when not escrowed", () => {
    const result = resolvePassportCustody({
      chainId: 84532,
      passportOwner: OWNER,
      listing: null,
    });
    assert.equal(result.isEscrowed, false);
    assert.equal(result.profileAddress.toLowerCase(), OWNER.toLowerCase());
    assert.equal(result.custodyAddress, undefined);
  });

  it("returns passport owner when listing inactive", () => {
    const result = resolvePassportCustody({
      chainId: 84532,
      passportOwner: OWNER,
      listing: { active: false, seller: SELLER },
    });
    assert.equal(result.isEscrowed, false);
    assert.equal(result.profileAddress.toLowerCase(), OWNER.toLowerCase());
  });
});
