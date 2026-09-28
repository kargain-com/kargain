/**
 * Commercial network label sole owner + product bans (corrective post-efeaf78).
 * Result causes; no chrome string fold; no nested unresolvedNamespaceCopy.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PassportUploadPreflightBanner } from "../components/passport/passport-upload-preflight-banner.tsx";
import {
  commercialNetworkLabel,
  commercialNetworkLabelCauseCopy,
  commercialPickerEntries,
} from "../lib/web3/chain-selector-state.ts";
import {
  COMMERCIAL_ACTIVE,
  type CommercialRegistry,
  type EvmCommercialActiveStack,
  registeredCommercialNamespaceIds,
  unresolvedNamespaceCopy,
} from "../lib/web3/commercial-active.ts";
import { mintKargainNamespace } from "../lib/web3/kargain-namespace.ts";
import {
  karProLeaveNetworkScopeCopy,
  karProNetworkInstrumentLine,
} from "../lib/kar-pro/membership-roster.ts";
import { passportAwayActionCopy } from "../lib/passport/presence.ts";
import { formatPassportShortLabel } from "../lib/passport/passport-token-id.ts";
import { mintWalletStandardChain } from "../lib/web3/wallet-standard-chain.ts";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";
import { FIXTURE_SVM_STACK } from "./fixtures/commercial-svm-stack.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXHAUSTIVENESS_FIXTURE = path.join(
  ROOT,
  "test/fixtures/wallet-standard-chain-exhaustiveness.ts",
);

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

const UNRESOLVED_SENTENCE = unresolvedNamespaceCopy();

function runTscOnFixture(source: string): {
  status: number | null;
  out: string;
} {
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), "kargain-wallet-std-chain-"),
  );
  const probe = path.join(tmp, "probe.ts");
  const tsconfigPath = path.join(tmp, "tsconfig.json");
  try {
    fs.writeFileSync(
      tsconfigPath,
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["ES2022"],
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "ESNext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            allowImportingTsExtensions: true,
            typeRoots: [path.join(ROOT, "node_modules/@types")],
            paths: {
              "@/*": [path.join(ROOT, "*")],
            },
            baseUrl: ROOT,
          },
          files: [probe],
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(probe, source);
    const result = spawnSync(
      "pnpm",
      ["exec", "tsc", "--noEmit", "-p", tsconfigPath],
      { cwd: ROOT, encoding: "utf8" },
    );
    return {
      status: result.status,
      out: `${result.stdout}\n${result.stderr}`,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Banned: Unknown network, shortChainName, chrome fold helper. */
export function findCommercialNetworkLabelViolations(
  sources: ReadonlyArray<{ path: string; text: string }>,
): string[] {
  const out: string[] = [];
  for (const { path: filePath, text } of sources) {
    if (filePath === "lib/architecture/chokepoints.ts") continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (
        line.includes('"Unknown network"') ||
        line.includes("'Unknown network'")
      ) {
        out.push(`${filePath}:${i + 1}:Unknown network`);
      }
      if (/\bshortChainName\b/.test(line)) {
        out.push(`${filePath}:${i + 1}:shortChainName`);
      }
      if (/\bcommercialNetworkChromeLabel\b/.test(line)) {
        out.push(`${filePath}:${i + 1}:commercialNetworkChromeLabel`);
      }
    }
  }
  return out;
}

/** unresolvedNamespaceCopy() must not appear inside a template literal. */
export function findNestedUnresolvedNamespaceCopyViolations(
  sources: ReadonlyArray<{ path: string; text: string }>,
): string[] {
  const out: string[] = [];
  for (const { path: filePath, text } of sources) {
    if (filePath === "lib/architecture/chokepoints.ts") continue;
    // Owner may call unresolvedNamespaceCopy inside cause copy — not a template nest.
    if (filePath === "lib/web3/chain-selector-state.ts") continue;
    if (filePath === "lib/web3/commercial-active.ts") continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (
        /`[^`]*\$\{\s*unresolvedNamespaceCopy\s*\(/.test(line) ||
        /`[^`]*unresolvedNamespaceCopy\s*\(/.test(line)
      ) {
        out.push(`${filePath}:${i + 1}:nested_unresolvedNamespaceCopy`);
      }
    }
  }
  return out;
}

/** ACCOUNT_KIND_EVM_ONLY_ABSENCE under components/. */
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

function assertNotNestedUnresolved(sentence: string): void {
  assert.ok(
    !sentence.includes(UNRESOLVED_SENTENCE) ||
      sentence === UNRESOLVED_SENTENCE,
    `alternative must not nest unresolved sentence inside longer prose: ${sentence}`,
  );
  if (sentence !== UNRESOLVED_SENTENCE) {
    assert.doesNotMatch(sentence, /This network is not configured in the app/);
  }
}

describe("commercialNetworkLabel Result owner", () => {
  it("live Solana Devnet namespace labels Solana Devnet", () => {
    assert.deepEqual(commercialNetworkLabel(SVM_NS), {
      ok: true,
      label: "Solana Devnet",
    });
  });

  it("EVM Base Sepolia keeps the viem name", () => {
    assert.deepEqual(commercialNetworkLabel(84532), {
      ok: true,
      label: "Base Sepolia",
    });
  });

  it("three causes: unresolved / evm unnamed / svm unresolved", () => {
    assert.deepEqual(commercialNetworkLabel(999_999_999), {
      ok: false,
      cause: "unresolved_namespace",
    });
    assert.equal(
      commercialNetworkLabelCauseCopy("unresolved_namespace"),
      UNRESOLVED_SENTENCE,
    );

    const unnamedNs = 2_000_049_990;
    const hub = COMMERCIAL_ACTIVE[84532];
    assert.ok(hub && hub.vm === "evm");
    const unnamedRegistry: CommercialRegistry = {
      ...COMMERCIAL_ACTIVE,
      [unnamedNs]: {
        ...(hub as EvmCommercialActiveStack),
        namespace: mintKargainNamespace(unnamedNs),
        chainId: 9_990_001,
      },
    };
    assert.deepEqual(commercialNetworkLabel(unnamedNs, unnamedRegistry), {
      ok: false,
      cause: "evm_chain_unnamed",
    });

    const svmBrokenNs = 2_000_049_991;
    const brokenStack = {
      ...FIXTURE_SVM_STACK,
      namespace: mintKargainNamespace(svmBrokenNs),
    };
    delete (brokenStack as { walletStandardChain?: unknown }).walletStandardChain;
    const svmRegistry: CommercialRegistry = {
      ...COMMERCIAL_ACTIVE,
      [svmBrokenNs]: brokenStack as typeof FIXTURE_SVM_STACK,
    };
    assert.deepEqual(commercialNetworkLabel(svmBrokenNs, svmRegistry), {
      ok: false,
      cause: "svm_chain_unresolved",
    });
  });

  it("every live COMMERCIAL_ACTIVE row has an ok label", () => {
    for (const id of registeredCommercialNamespaceIds()) {
      const named = commercialNetworkLabel(id);
      assert.equal(
        named.ok,
        true,
        `namespace ${id} must have ok label, got ${JSON.stringify(named)}`,
      );
    }
  });

  it("SVM mainnet planted stack labels Solana; testnet mint refused", () => {
    assert.throws(
      () => mintWalletStandardChain("solana:testnet"),
      /solana:devnet \| solana:mainnet/,
    );
    const mainnetNs = 2_000_049_995;
    const registry: CommercialRegistry = {
      ...COMMERCIAL_ACTIVE,
      [mainnetNs]: {
        ...FIXTURE_SVM_STACK,
        namespace: mintKargainNamespace(mainnetNs),
        walletStandardChain: mintWalletStandardChain("solana:mainnet"),
      },
    };
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

describe("sentence sites — whole alternative (five pins)", () => {
  const FOREIGN = 9_876_543;

  it("presence away + unregistered location → no-location sentence", () => {
    const copy = passportAwayActionCopy({
      status: "away",
      locationChainId: FOREIGN,
    });
    assert.equal(
      copy,
      "This passport is on another chain. Return it here to restore this action.",
    );
    assertNotNestedUnresolved(copy);
  });

  it("karPro leave / instrument alternatives", () => {
    const leave = karProLeaveNetworkScopeCopy(FOREIGN);
    assert.equal(leave, "This leave applies only to this network.");
    assertNotNestedUnresolved(leave);

    const instrument = karProNetworkInstrumentLine(FOREIGN);
    assert.equal(instrument, UNRESOLVED_SENTENCE);
    assertNotNestedUnresolved(instrument);
  });

  it("profile-passport-card pattern: on another network", () => {
    const named = commercialNetworkLabel(FOREIGN);
    const state = named.ok ? `on ${named.label}` : "on another network";
    assert.equal(named.ok, false);
    assert.equal(state, "on another network");
    assertNotNestedUnresolved(state);
  });

  it("bridge timeout alternative does not nest unresolved", () => {
    const named = commercialNetworkLabel(FOREIGN);
    const msg = named.ok
      ? `Bridge sent, but delivery was not confirmed on ${named.label} within 10 minutes. Check LayerZero Scan.`
      : "Bridge sent, but delivery was not confirmed within 10 minutes. Check LayerZero Scan.";
    assert.equal(
      msg,
      "Bridge sent, but delivery was not confirmed within 10 minutes. Check LayerZero Scan.",
    );
    assertNotNestedUnresolved(msg);
  });
});

describe("SVM-origin passport token short label", () => {
  it("uses Solana Devnet, not Chain 2000040168", () => {
    const tokenId = ((BigInt(SVM_NS) << 128n) | 7n).toString();
    assert.equal(formatPassportShortLabel(tokenId), "#7 · Solana Devnet");
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
  });
});

describe("wallet-standard-chain exhaustiveness fixture", () => {
  it("missing mainnet case fails typecheck; @ts-expect-error keeps green", () => {
    const live = fs.readFileSync(EXHAUSTIVENESS_FIXTURE, "utf8");
    assert.match(live, /\/\/\s*@ts-expect-error/);
    assert.match(live, /solana:mainnet omitted/);

    const withoutDirective = live.replace(
      /^\s*\/\/\s*@ts-expect-error[^\n]*\n/m,
      "",
    );
    assert.doesNotMatch(withoutDirective, /\/\/\s*@ts-expect-error/);

    const red = runTscOnFixture(withoutDirective);
    assert.notEqual(red.status, 0, `expected tsc red, got:\n${red.out}`);
    assert.match(red.out, /never|solana:mainnet|not assignable/i);

    const green = runTscOnFixture(live);
    assert.equal(green.status, 0, `expected tsc green, got:\n${green.out}`);
  });
});

describe("commercial-network-label-policy", () => {
  it("planted chrome fold / Unknown network / shortChainName are red; live product clean", () => {
    const planted = findCommercialNetworkLabelViolations([
      {
        path: "components/shell/chain-selector.tsx",
        text: 'const name = commercialNetworkChromeLabel(id) ?? "Unknown network";',
      },
      {
        path: "lib/passport/presence.ts",
        text: "return shortChainName(id);",
      },
    ]);
    assert.ok(planted.some((v) => v.includes("commercialNetworkChromeLabel")));
    assert.ok(planted.some((v) => v.includes("Unknown network")));
    assert.ok(planted.some((v) => v.includes("shortChainName")));

    const scan = scanProductSources((rel, src) => {
      const hits = findCommercialNetworkLabelViolations([
        { path: rel, text: src },
      ]);
      return hits.length > 0 ? hits.join("; ") : false;
    });
    assertCleanProductScan(scan);
  });

  it("planted nested unresolvedNamespaceCopy in template is red; live product clean", () => {
    const planted = findNestedUnresolvedNamespaceCopyViolations([
      {
        path: "lib/passport/presence.ts",
        text: "return `This passport is on ${unresolvedNamespaceCopy()}.`;",
      },
    ]);
    assert.deepEqual(planted, [
      "lib/passport/presence.ts:1:nested_unresolvedNamespaceCopy",
    ]);

    const scan = scanProductSources((rel, src) => {
      const hits = findNestedUnresolvedNamespaceCopyViolations([
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
