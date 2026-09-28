/**
 * Commercial network label sole owner + product bans.
 * Pins Solana Devnet display name; Unknown network / shortChainName / EVM-only
 * account-kind absence sentence must not appear under product roots.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PassportUploadPreflightBanner } from "../components/passport/passport-upload-preflight-banner.tsx";
import {
  commercialNetworkChromeLabel,
  commercialNetworkLabel,
  commercialPickerEntries,
} from "../lib/web3/chain-selector-state.ts";
import {
  COMMERCIAL_ACTIVE,
  type CommercialRegistry,
  registeredCommercialNamespaceIds,
  unresolvedNamespaceCopy,
} from "../lib/web3/commercial-active.ts";
import { mintKargainNamespace } from "../lib/web3/kargain-namespace.ts";
import { formatPassportShortLabel } from "../lib/passport/passport-token-id.ts";
import { mintWalletStandardChain } from "../lib/web3/wallet-standard-chain.ts";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";
import { FIXTURE_SVM_STACK } from "./fixtures/commercial-svm-stack.ts";

const SVM_NS = Number(
  (() => {
    const ids = registeredCommercialNamespaceIds().filter(
      (id) => COMMERCIAL_ACTIVE[id]?.vm === "svm",
    );
    assert.equal(ids.length, 1, "live registry must have exactly one SVM row");
    return ids[0]!;
  })(),
);

assert.equal(SVM_NS, 2000040168);

/** `"Unknown network"` string literal or `shortChainName` identifier in product. */
export function findCommercialNetworkLabelViolations(
  sources: ReadonlyArray<{ path: string; text: string }>,
): string[] {
  const out: string[] = [];
  for (const { path: filePath, text } of sources) {
    // Ban prose lives on the choke-point registry — not a product consumer.
    if (filePath === "lib/architecture/chokepoints.ts") continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.includes('"Unknown network"') || line.includes("'Unknown network'")) {
        out.push(`${filePath}:${i + 1}:Unknown network`);
      }
      if (/\bshortChainName\b/.test(line)) {
        out.push(`${filePath}:${i + 1}:shortChainName`);
      }
    }
  }
  return out;
}

/** ACCOUNT_KIND_EVM_ONLY_ABSENCE symbol or its former sentence under components/. */
export function findAccountKindEvmOnlyAbsenceViolations(
  sources: ReadonlyArray<{ path: string; text: string }>,
): string[] {
  const sentence = "Wallet account kind applies to Ethereum sessions only.";
  const out: string[] = [];
  for (const { path: filePath, text } of sources) {
    if (!filePath.startsWith("components/")) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (/\bACCOUNT_KIND_EVM_ONLY_ABSENCE\b/.test(line)) {
        out.push(`${filePath}:${i + 1}:ACCOUNT_KIND_EVM_ONLY_ABSENCE`);
      }
      if (line.includes(sentence)) {
        out.push(`${filePath}:${i + 1}:evm_only_absence_sentence`);
      }
    }
  }
  return out;
}

describe("commercialNetworkLabel Result owner", () => {
  it("live Solana Devnet namespace labels Solana Devnet", () => {
    const named = commercialNetworkLabel(SVM_NS);
    assert.deepEqual(named, { ok: true, label: "Solana Devnet" });
    assert.equal(commercialNetworkChromeLabel(SVM_NS), "Solana Devnet");
  });

  it("EVM Base Sepolia keeps the viem name", () => {
    assert.deepEqual(commercialNetworkLabel(84532), {
      ok: true,
      label: "Base Sepolia",
    });
  });

  it("unregistered namespace → unresolved_namespace (never a sentence value)", () => {
    assert.deepEqual(commercialNetworkLabel(999_999_999), {
      ok: false,
      cause: "unresolved_namespace",
    });
    assert.equal(
      commercialNetworkChromeLabel(999_999_999),
      unresolvedNamespaceCopy(),
    );
  });

  it("SVM walletStandardChain map covers testnet and mainnet via planted stacks", () => {
    const testnetNs = 2_000_049_996;
    const mainnetNs = 2_000_049_995;
    const registry: CommercialRegistry = {
      ...COMMERCIAL_ACTIVE,
      [testnetNs]: {
        ...FIXTURE_SVM_STACK,
        namespace: mintKargainNamespace(testnetNs),
        walletStandardChain: mintWalletStandardChain("solana:testnet"),
      },
      [mainnetNs]: {
        ...FIXTURE_SVM_STACK,
        namespace: mintKargainNamespace(mainnetNs),
        walletStandardChain: mintWalletStandardChain("solana:mainnet"),
      },
    };
    assert.deepEqual(commercialNetworkLabel(testnetNs, registry), {
      ok: true,
      label: "Solana Testnet",
    });
    assert.deepEqual(commercialNetworkLabel(mainnetNs, registry), {
      ok: true,
      label: "Solana",
    });
  });

  it("picker never carries Unknown network; planted SVM uses Solana Devnet", () => {
    const plantedNs = 2_000_049_997;
    const registry: CommercialRegistry = {
      ...COMMERCIAL_ACTIVE,
      [plantedNs]: {
        ...FIXTURE_SVM_STACK,
        namespace: mintKargainNamespace(plantedNs),
      },
    };
    const entries = commercialPickerEntries(registry);
    assert.ok(entries.every((e) => e.label !== "Unknown network"));
    assert.equal(
      entries.find((e) => e.namespace === plantedNs)?.label,
      "Solana Devnet",
    );
  });
});

describe("SVM-origin passport token short label", () => {
  it("uses Solana Devnet, not Chain 2000040168", () => {
    const tokenId = ((BigInt(SVM_NS) << 128n) | 7n).toString();
    assert.equal(
      formatPassportShortLabel(tokenId),
      "#7 · Solana Devnet",
    );
  });

  it("unregistered origin falls back to Chain ${n}", () => {
    const foreign = 9_876_543;
    const tokenId = ((BigInt(foreign) << 128n) | 1n).toString();
    assert.equal(
      formatPassportShortLabel(tokenId),
      `#1 · Chain ${foreign}`,
    );
  });
});

describe("passport upload preflight banner — SVM honesty", () => {
  it("accountKind null + photos → photo-count line only; no account-kind sentence", () => {
    const photo = new File([new Uint8Array([1, 2, 3])], "a.webp", {
      type: "image/webp",
    });
    const html = renderToStaticMarkup(
      createElement(PassportUploadPreflightBanner, {
        accountKind: null,
        photos: [photo],
      }),
    );
    assert.match(html, /1 photo ·/);
    assert.doesNotMatch(
      html,
      /Wallet account kind applies to Ethereum sessions only/,
    );
    assert.doesNotMatch(html, /Smart contract wallets/);
  });
});

describe("commercial-network-label-policy", () => {
  it("planted Unknown network / shortChainName are red; live product is clean", () => {
    const planted = findCommercialNetworkLabelViolations([
      {
        path: "components/shell/chain-selector.tsx",
        text: 'const name = shortChainName(id) ?? "Unknown network";',
      },
    ]);
    assert.ok(planted.some((v) => v.includes("shortChainName")));
    assert.ok(planted.some((v) => v.includes("Unknown network")));

    const scan = scanProductSources((rel, src) => {
      const hits = findCommercialNetworkLabelViolations([
        { path: rel, text: src },
      ]);
      return hits.length > 0 ? hits.join("; ") : false;
    });
    assertCleanProductScan(scan);
  });

  it("planted ACCOUNT_KIND_EVM_ONLY_ABSENCE under components is red; live components clean", () => {
    const planted = findAccountKindEvmOnlyAbsenceViolations([
      {
        path: "components/passport/passport-upload-preflight-banner.tsx",
        text: "return ACCOUNT_KIND_EVM_ONLY_ABSENCE;",
      },
    ]);
    assert.deepEqual(planted, [
      "components/passport/passport-upload-preflight-banner.tsx:1:ACCOUNT_KIND_EVM_ONLY_ABSENCE",
    ]);

    const scan = scanProductSources((rel, src) => {
      const hits = findAccountKindEvmOnlyAbsenceViolations([
        { path: rel, text: src },
      ]);
      return hits.length > 0 ? hits.join("; ") : false;
    });
    assertCleanProductScan(scan);
  });
});
