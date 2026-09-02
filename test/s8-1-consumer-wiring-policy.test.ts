/**
 * S8-1-fix — consume pins for the six consumer files whose wiring was
 * unasserted when commerce-ui/passport-ui counts stayed flat at 8622df7.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { openableTermsQueryKey } from "../hooks/use-openable-terms.ts";
import { indexerQueryKey } from "../lib/web3/indexer-query-keys.ts";
import {
  POLICY_SCAN_ROOT,
  PRODUCT_POLICY_SCAN_ROOTS,
} from "./policy-scan-helpers.ts";
import {
  chainlinkFxWiringOk,
  indexerKeyWiringOk,
  instrumentReadoutsWiringOk,
} from "./s8-1-consumer-wiring-helpers.ts";

const ROOT = POLICY_SCAN_ROOT;

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("S8-1 consumer wiring (six files)", () => {
  it("passport-instrument-readouts uses network-explorer + requireCommercialActive", () => {
    const path = "components/passport/passport-instrument-readouts.tsx";
    const text = src(path);
    assert.equal(instrumentReadoutsWiringOk(text), true);
    const dirty = `
import { explorerAddressUrl } from "@/lib/web3/wallet-account";
explorerAddressUrl(84532, addr);
`;
    assert.equal(instrumentReadoutsWiringOk(dirty), false);
  });

  it("consigned-vehicles-tab builds agent keys with namespace first", () => {
    const text = src("components/profile/consigned-vehicles-tab.tsx");
    assert.equal(indexerKeyWiringOk(text, "agent-mandates"), true);
    assert.equal(indexerKeyWiringOk(text, "agent-consignments"), true);
    const dirty = `queryKey: ["agent-mandates", wallet, targetChain, "awaiting"]`;
    assert.equal(indexerKeyWiringOk(dirty, "agent-mandates"), false);
    const good = indexerQueryKey(
      "agent-mandates",
      84532,
      "0xabc",
      "awaiting",
    );
    const oldOrder = ["agent-mandates", "0xabc", 84532, "awaiting"] as const;
    assert.notDeepEqual([...oldOrder], [...good]);
    assert.equal(good[1], "84532");
  });

  it("delegated-vehicles-tab builds owner keys with namespace first", () => {
    const text = src("components/profile/delegated-vehicles-tab.tsx");
    assert.equal(indexerKeyWiringOk(text, "owner-mandates"), true);
    assert.equal(indexerKeyWiringOk(text, "owner-consignments"), true);
    const dirty = `queryKey: ["owner-mandates", wallet, targetChain, "awaiting"]`;
    assert.equal(indexerKeyWiringOk(dirty, "owner-mandates"), false);
  });

  it("use-auction-detail uses indexerQueryKey for consignment-detail", () => {
    const text = src("hooks/use-auction-detail.ts");
    assert.equal(indexerKeyWiringOk(text, "consignment-detail"), true);
    const dirty = `queryKey: ["consignment-detail", chainId, tokenId]`;
    assert.equal(indexerKeyWiringOk(dirty, "consignment-detail"), false);
    assert.deepEqual(indexerQueryKey("consignment-detail", 84532, "1"), [
      "consignment-detail",
      "84532",
      "1",
    ]);
  });

  it("openableTermsQueryKey places namespace at segment 1 as string", () => {
    const key = openableTermsQueryKey(84532, "fixedPrice");
    assert.deepEqual(key, [
      "commerce-open-options",
      "84532",
      "fixedPrice",
    ]);
    const dirty = ["commerce-open-options", "fixedPrice", 84532] as const;
    assert.notDeepEqual([...dirty], [...key]);
    assert.notEqual(String(dirty[1]), "84532");
  });

  it("use-chainlink-rates consumes fxRateChainIdFor(hub stack)", () => {
    const text = src("lib/marketplace/use-chainlink-rates.ts");
    assert.equal(chainlinkFxWiringOk(text), true);
    const dirty = `
import { fxRateChainId } from "@/lib/web3/chain-context";
const fxChain = fxRateChainId();
`;
    assert.equal(chainlinkFxWiringOk(dirty), false);
  });
});

describe("product policy scanner sole walk", () => {
  it("ownership policies do not redefine walkTsFiles or a private SCAN_ROOTS", () => {
    const policies = [
      "test/network-explorer-owner-policy.test.ts",
      "test/network-vm-component-policy.test.ts",
      "test/passport-presence-owner-policy.test.ts",
    ] as const;
    for (const rel of policies) {
      const text = src(rel);
      assert.match(text, /policy-scan-helpers/, rel);
      assert.doesNotMatch(text, /function\s+walkTsFiles\s*\(/, rel);
      assert.doesNotMatch(
        text,
        /const\s+SCAN_ROOTS\s*=/,
        `${rel} must not fork SCAN_ROOTS`,
      );
    }
    assert.deepEqual([...PRODUCT_POLICY_SCAN_ROOTS], [
      "app",
      "components",
      "hooks",
      "lib",
    ]);
  });
});
