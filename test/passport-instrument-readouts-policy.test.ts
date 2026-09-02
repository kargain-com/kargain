/**
 * Passport-ui: instrument readouts call commercialExplorerAddressUrl (S8-1-close).
 * DOM href without render is not observed — behaviour covered is the pure producer.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";

import { commercialExplorerAddressUrl } from "../lib/web3/network-explorer.ts";
import { mintExplorerOrigin } from "../lib/web3/explorer-origin.ts";

describe("passport instrument readouts explorer producer", () => {
  it("commercialExplorerAddressUrl builds Base Sepolia address URL", () => {
    const addr = getAddress("0x0000000000000000000000000000000000000001");
    assert.equal(
      commercialExplorerAddressUrl(84532, addr),
      `https://sepolia.basescan.org/address/${addr}`,
    );
  });

  it("empty origin cannot be minted into a stack field", () => {
    assert.throws(
      () => mintExplorerOrigin(""),
      /Invalid ExplorerOrigin: empty/,
    );
  });
});
