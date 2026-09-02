/**
 * S8-1-close — behavioural consume pins (producer output, not source text).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { openableTermsQueryKey } from "../hooks/use-openable-terms.ts";
import {
  fxRateChainIdFor,
  hubFxRateChainId,
} from "../lib/web3/chain-context.ts";
import { indexerQueryKey } from "../lib/web3/indexer-query-keys.ts";
import { commercialExplorerAddressUrl } from "../lib/web3/network-explorer.ts";
import { mintCommercialNativeUnit } from "../lib/web3/commercial-native-unit.ts";
import { mintExplorerOrigin } from "../lib/web3/explorer-origin.ts";
import {
  nativeUnitOf,
  requireCommercialActive,
} from "../lib/web3/commercial-active.ts";
import {
  POLICY_SCAN_ROOT,
  PRODUCT_POLICY_SCAN_ROOTS,
} from "./policy-scan-helpers.ts";
import { FIXTURE_SVM_STACK } from "./fixtures/commercial-svm-stack.ts";

const ROOT = POLICY_SCAN_ROOT;

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("S8-1 consumer wiring (behavioural)", () => {
  it("commercialExplorerAddressUrl yields Base Sepolia origin + address path", () => {
    const addr = "0x0000000000000000000000000000000000000001";
    assert.equal(
      commercialExplorerAddressUrl(84532, addr),
      `https://sepolia.basescan.org/address/${addr}`,
    );
  });

  it("indexerQueryKey places namespace at [1] — consumer proof is live literal ban", () => {
    assert.deepEqual(indexerQueryKey("consignment-detail", 84532, "1"), [
      "consignment-detail",
      "84532",
      "1",
    ]);
    assert.deepEqual(
      indexerQueryKey("agent-mandates", 84532, "0xabc", "awaiting"),
      ["agent-mandates", "84532", "0xabc", "awaiting"],
    );
    assert.deepEqual(
      indexerQueryKey("owner-mandates", 84532, "0xabc", "awaiting"),
      ["owner-mandates", "84532", "0xabc", "awaiting"],
    );
    const oldOrder = ["agent-mandates", "0xabc", 84532, "awaiting"] as const;
    assert.notDeepEqual(
      [...oldOrder],
      [...indexerQueryKey("agent-mandates", 84532, "0xabc", "awaiting")],
    );
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

  it("hubFxRateChainId returns the hub pin; SVM FX refuse stays named", () => {
    assert.equal(hubFxRateChainId(), 84532);
    assert.throws(
      () => fxRateChainIdFor(FIXTURE_SVM_STACK),
      /has no FX env pin/,
    );
  });
});

describe("branded network-class ingress (S8-1-close)", () => {
  it("mintExplorerOrigin refuses empty / whitespace", () => {
    assert.throws(() => mintExplorerOrigin(""), /Invalid ExplorerOrigin: empty/);
    assert.throws(() => mintExplorerOrigin("   "), /Invalid ExplorerOrigin: empty/);
    assert.throws(() => mintExplorerOrigin("/"), /Invalid ExplorerOrigin: empty/);
    const origin = mintExplorerOrigin("https://explorer.example/");
    assert.equal(origin, "https://explorer.example");
  });

  it("mintCommercialNativeUnit refuses empty symbol and bad decimals", () => {
    assert.throws(
      () => mintCommercialNativeUnit("", 18),
      /Invalid CommercialNativeUnit: empty symbol/,
    );
    assert.throws(
      () => mintCommercialNativeUnit("SOL", Number.NaN),
      /Invalid CommercialNativeUnit: decimals/,
    );
    assert.throws(
      () => mintCommercialNativeUnit("SOL", 1.5),
      /Invalid CommercialNativeUnit: decimals/,
    );
    assert.deepEqual(mintCommercialNativeUnit("SOL", 9), {
      symbol: "SOL",
      decimals: 9,
    });
  });

  it("live stacks and fixture carry minted origin + unit", () => {
    const hub = requireCommercialActive(84532);
    assert.equal(hub.explorerBaseUrl, "https://sepolia.basescan.org");
    assert.deepEqual(nativeUnitOf(hub), { symbol: "ETH", decimals: 18 });
    assert.deepEqual(nativeUnitOf(FIXTURE_SVM_STACK), {
      symbol: "SOL",
      decimals: 9,
    });
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

  it("asKargainNamespace is deleted — sole mint entrance remains", () => {
    const text = src("lib/web3/kargain-namespace.ts");
    assert.doesNotMatch(text, /\basKargainNamespace\b/);
    assert.match(text, /\bmintKargainNamespace\b/);
  });
});
