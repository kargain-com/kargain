import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseVerifierDirectoryEntry } from "../app/actions/verifier-directory.ts";

describe("parseVerifierDirectoryEntry", () => {
  it("keeps chainId on a valid row", () => {
    const row = parseVerifierDirectoryEntry({
      chainId: 84532,
      address: "0xabcdef1234567890abcdef1234567890abcdef12",
      category: 1,
      name: "Inspector",
      slug: "inspector",
      metadataURI: "ar://x",
      active: true,
      verificationCount: 3,
      verificationFee: "0",
    });
    assert.ok(row);
    assert.equal(row!.chainId, 84532);
    assert.equal(row!.name, "Inspector");
  });

  it("drops rows without a positive chainId", () => {
    assert.equal(
      parseVerifierDirectoryEntry({
        address: "0xabcdef1234567890abcdef1234567890abcdef12",
        category: 1,
        name: "Inspector",
        metadataURI: "",
        active: true,
        verificationCount: 0,
      }),
      null,
    );
    assert.equal(
      parseVerifierDirectoryEntry({
        chainId: 0,
        address: "0xabcdef1234567890abcdef1234567890abcdef12",
        category: 1,
        name: "Inspector",
        metadataURI: "",
        active: true,
        verificationCount: 0,
      }),
      null,
    );
  });
});
