/**
 * Passport-ui consume pin: instrument readouts use network-explorer owner (S8-1-fix).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { instrumentReadoutsWiringOk } from "./s8-1-consumer-wiring-helpers.ts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const READOUTS = join(
  ROOT,
  "components/passport/passport-instrument-readouts.tsx",
);

describe("passport instrument readouts explorer wiring", () => {
  it("imports explorerAddressUrl from network-explorer with commercial stack", () => {
    const text = readFileSync(READOUTS, "utf8");
    assert.equal(instrumentReadoutsWiringOk(text), true);
  });

  it("constructed bare-chainId explorer call is red", () => {
    const dirty = `
import { explorerAddressUrl } from "@/lib/web3/wallet-account";
explorerAddressUrl(84532, addr);
`;
    assert.equal(instrumentReadoutsWiringOk(dirty), false);
  });
});
