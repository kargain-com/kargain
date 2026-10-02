/**
 * N1 — each soft-door site calls its named chrome seam; none gates with inline
 * `wc != null` / `wagmi.ok` formulas that duplicate those seams.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { scanProductSources } from "./policy-scan-helpers";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Eleven soft-door sites → required seam symbol (must appear in source). */
export const N1_SITE_SEAMS = {
  "components/auction/auction-settlement-panel.tsx": "wrongChainFromWagmi",
  "components/auction/create-auction-panel.tsx": "wrongChainFromWagmi",
  "components/auction/agent-create-auction-panel.tsx": "wrongChainFromWagmi",
  "components/auction/auction-bid-panel.tsx": "wrongChainFromWagmi",
  "components/auction/auction-detail-client-island.tsx":
    "erc20DecimalsQueryEnabled",
  "components/marketplace/listing-detail-client-island.tsx":
    "erc20DecimalsQueryEnabled",
  "components/auction/auction-finalize-panel.tsx": "evmWagmiWriteAdmitted",
  "components/providers/messaging-session-provider.tsx": "wagmiChainIdOpts",
  "hooks/use-peer-identity.ts": "peerIdentityMembershipChainId",
  "hooks/use-kar-pro-on-chain-profile.ts": "karProOnChainReadsEnabled",
  "hooks/use-bridge.ts": "pollDstOwner",
} as const;

export type N1SitePath = keyof typeof N1_SITE_SEAMS;

/** Inline gating that must live only in the chrome seam owner. */
const INLINE_WC_GATE =
  /\bwc\s*!=\s*null\b|\bwagmi(?:Chain)?\.ok\s*&&\s*(?:wallet|needs)/;

export function findN1SiteSeamViolations(
  rel: string,
  source: string,
): string | false {
  const seam = N1_SITE_SEAMS[rel as N1SitePath];
  if (seam == null) return false;
  if (!new RegExp(`\\b${seam}\\b`).test(source)) {
    return `missing seam ${seam}`;
  }
  // Sites that own wrongChain / readsEnabled must not re-state the formula.
  if (seam === "wrongChainFromWagmi") {
    if (
      /wrongChain\s*=/.test(source) &&
      !/wrongChainFromWagmi\s*\(/.test(source)
    ) {
      return "inline wrongChain without wrongChainFromWagmi";
    }
  }
  if (seam === "karProOnChainReadsEnabled") {
    if (
      /readsEnabled\s*=/.test(source) &&
      !/karProOnChainReadsEnabled\s*\(/.test(source)
    ) {
      return "inline readsEnabled without karProOnChainReadsEnabled";
    }
  }
  if (seam === "peerIdentityMembershipChainId") {
    if (
      /membershipChainId\s*=/.test(source) &&
      !/peerIdentityMembershipChainId\s*\(/.test(source)
    ) {
      return "inline membershipChainId without peerIdentityMembershipChainId";
    }
  }
  if (seam === "erc20DecimalsQueryEnabled") {
    if (
      /enabled:\s*needsErc20Decimals\s*&&/.test(source) ||
      (INLINE_WC_GATE.test(source) &&
        !/erc20DecimalsQueryEnabled\s*\(/.test(source))
    ) {
      return "inline erc20 enabled without erc20DecimalsQueryEnabled";
    }
  }
  return false;
}

function scanTempSiteTree(
  files: Record<string, string>,
): string[] {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "n1-seam-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body, "utf8");
    }
    const out: string[] = [];
    for (const rel of Object.keys(N1_SITE_SEAMS)) {
      const full = path.join(tmp, rel);
      if (!fs.existsSync(full)) continue;
      const source = fs.readFileSync(full, "utf8");
      const hit = findN1SiteSeamViolations(rel, source);
      if (hit) out.push(`${rel}: ${hit}`);
    }
    return out;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe("n1-site-seam-binding-policy", () => {
  it("temp plant missing seam is red; product tree green", () => {
    const plant = scanTempSiteTree({
      "hooks/use-kar-pro-on-chain-profile.ts": `
const wagmi = evmWagmiChain(chainId);
const wc = wagmi.ok ? wagmi.chainId : undefined;
const readsEnabled = Boolean(enabled && address && chainId != null && wc != null);
`,
    });
    assert.deepEqual(plant, [
      "hooks/use-kar-pro-on-chain-profile.ts: missing seam karProOnChainReadsEnabled",
    ]);

    const plantPeer = scanTempSiteTree({
      "hooks/use-peer-identity.ts": `
const membershipChainId =
  options?.chainId != null && isCommercialEip155Id(options.chainId)
    ? options.chainId
    : null;
`,
    });
    assert.ok(
      plantPeer.some((v) => v.includes("peerIdentityMembershipChainId")),
      `expected peer plant red; got ${JSON.stringify(plantPeer)}`,
    );

    const violations: string[] = [];
    for (const rel of Object.keys(N1_SITE_SEAMS) as N1SitePath[]) {
      const full = path.join(ROOT, rel);
      assert.equal(fs.existsSync(full), true, `missing site ${rel}`);
      const source = fs.readFileSync(full, "utf8");
      const hit = findN1SiteSeamViolations(rel, source);
      if (hit) violations.push(`${rel}: ${hit}`);
    }
    assert.deepEqual(violations, [], violations.join("\n"));

    // Chrome owner itself is not a site — scan must not invent hits there.
    const chromeScan = scanProductSources((rel, source) => {
      if (rel === "lib/web3/evm-wagmi-chrome.ts") return false;
      return findN1SiteSeamViolations(rel, source);
    });
    assert.deepEqual(
      chromeScan.violations,
      [],
      chromeScan.violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });
});
