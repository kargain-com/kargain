/**
 * Surface admission — census then session (S8-D4 account chrome).
 *
 * Guards (RED plant → green):
 * (a) chrome requireEvmSession for connectedness
 * (b) composer that checks session before census
 * (c) second copy of SurfaceSupportCause or class-C sentence
 * (d) numeric default (?? 0) on pending-claims / unread fact
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DISCONNECTED_ACCOUNT,
  svmActiveAccountFromAddress,
  type ActiveAccount,
} from "@/lib/web3/active-account";
import { mintKargainNamespace } from "@/lib/web3/kargain-namespace";
import {
  admitSessionSurface,
  admitSurface,
} from "@/lib/web3/surface-admission";
import { admitCreatePassport } from "@/lib/passport/create-passport-surface";
import {
  txWriteAvailabilityForCapability,
} from "@/lib/web3/tx-write-availability";
import {
  SURFACE_CLASS_C_CAPABILITIES,
  SURFACE_SUPPORT_CAUSES,
  SURFACE_SUPPORT_TABLE,
  surfaceClassCCauseCopy,
  surfaceClassOf,
  surfaceSupport,
  surfaceSupportCauseCopy,
  type SurfaceCapability,
  type SurfaceSupportTable,
} from "@/lib/web3/surface-support";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const SOLANA_NS = 2_000_040_168;

const EVM_ACCOUNT: ActiveAccount = {
  status: "connected",
  vm: "evm",
  address: "0x1111111111111111111111111111111111111111",
  namespace: mintKargainNamespace(84532),
  chainId: 84532,
};

const SVM_ACCOUNT = svmActiveAccountFromAddress(
  "D87okZNVcTr7AAb9mnH6mBTwS9HRryhaq7XNLzUwxKCb",
);

/** Measured chrome set — connectedness must not use requireEvmSession / evm.ok. */
const CHROME_CONNECTEDNESS_FILES = [
  "components/shell/app-top-nav.tsx",
  "components/shell/mobile-bottom-nav.tsx",
  "hooks/use-show-become-karpro.ts",
  "components/notifications/notifications-unread-badge.tsx",
  "components/claims/claims-pending-banner.tsx",
  "components/identity/identity-header.tsx",
  "components/profile/profile-page.tsx",
  "components/profile/profile-verifier-stats-band.tsx",
  "components/kar-pro/kar-pro-page-content.tsx",
  "hooks/use-is-profile-owner.ts",
] as const;

function chromeConnectednessViolation(
  rel: string,
  source: string,
): string | false {
  if (!(CHROME_CONNECTEDNESS_FILES as readonly string[]).includes(rel)) {
    return false;
  }
  // Connectedness patterns: isConnected = evm.ok / requireEvmSession for signed-in
  if (
    /const\s+isConnected\s*=\s*evm\.ok\b/.test(source) ||
    /const\s+badgesConnected\s*=\s*evm\.ok\b/.test(source) ||
    /void\s+requireEvmSession\s*\(/.test(source)
  ) {
    return `chrome connectedness via requireEvmSession/evm.ok (use account.status === "connected"): ${rel}`;
  }
  return false;
}

/** Planted session-before-census composer (mirrors retired ForCapability order). */
function plantedSessionFirstAdmit(
  account: ActiveAccount,
  capability: SurfaceCapability,
  namespace: number,
  table: SurfaceSupportTable = SURFACE_SUPPORT_TABLE,
): ReturnType<typeof admitSurface> {
  if (account.status !== "connected") {
    return { status: "disconnected" };
  }
  return admitSurface(account, capability, namespace, undefined, table);
}

describe("admitSurface — census before session", () => {
  it("disconnected + unsupported → support_refused (not disconnected)", () => {
    const admission = admitSurface(
      DISCONNECTED_ACCOUNT,
      "kar_pro_join",
      SOLANA_NS,
    );
    assert.equal(admission.status, "support_refused");
    if (admission.status === "support_refused") {
      assert.equal(admission.cause, "product_owner_owed");
    }
  });

  it("disconnected + unresolved ns → unresolved_namespace (not disconnected)", () => {
    const admission = admitSurface(
      DISCONNECTED_ACCOUNT,
      "set_passport_uri",
      999_999_999,
    );
    assert.equal(admission.status, "unresolved_namespace");
  });

  it("disconnected + supported → disconnected", () => {
    const admission = admitSurface(
      DISCONNECTED_ACCOUNT,
      "set_passport_uri",
      84532,
    );
    assert.equal(admission.status, "disconnected");
  });

  it("SVM + messaging_session → family_required", () => {
    const admission = admitSessionSurface(SVM_ACCOUNT, "messaging_session");
    assert.equal(admission.status, "family_required");
    if (admission.status === "family_required") {
      assert.equal(admission.wanted, "evm");
      assert.equal(admission.capability, "messaging_session");
    }
  });

  it("admitCreatePassport and ForCapability adapt admitSurface (no second composer)", () => {
    const create = admitCreatePassport(DISCONNECTED_ACCOUNT, SOLANA_NS);
    assert.equal(create.status, "support_refused");
    const write = txWriteAvailabilityForCapability(
      DISCONNECTED_ACCOUNT,
      "kar_pro_join",
      SOLANA_NS,
    );
    assert.equal(write.available, false);
    if (!write.available) {
      assert.equal(write.cause, "product_owner_owed");
    }
  });

  it("(b) plant: session-before-census diverges from live admitSurface", () => {
    const planted = plantedSessionFirstAdmit(
      DISCONNECTED_ACCOUNT,
      "kar_pro_join",
      SOLANA_NS,
    );
    const live = admitSurface(DISCONNECTED_ACCOUNT, "kar_pro_join", SOLANA_NS);
    assert.equal(planted.status, "disconnected");
    assert.equal(live.status, "support_refused");
    assert.notEqual(planted.status, live.status);
  });
});

describe("chrome connectedness (a)", () => {
  it("measured chrome set does not use requireEvmSession for connectedness", () => {
    const scan = scanProductSources(chromeConnectednessViolation);
    assertCleanProductScan(scan);
    assert.ok(
      scan.filesRead >= CHROME_CONNECTEDNESS_FILES.length,
      `filesRead=${scan.filesRead}`,
    );
  });

  it("(a) plant: evm.ok connectedness is red then green on live scan", () => {
    const planted = `const evm = requireEvmSession(account);\nconst isConnected = evm.ok;\n`;
    const hit = chromeConnectednessViolation(
      "components/shell/app-top-nav.tsx",
      planted,
    );
    assert.equal(
      hit,
      'chrome connectedness via requireEvmSession/evm.ok (use account.status === "connected"): components/shell/app-top-nav.tsx',
    );
    assertCleanProductScan(scanProductSources(chromeConnectednessViolation));
  });
});

describe("sentence sole owners (c)", () => {
  const SUPPORT_SENTENCES = SURFACE_SUPPORT_CAUSES.map((c) =>
    surfaceSupportCauseCopy(c),
  );
  const CLASS_C_SENTENCES = SURFACE_CLASS_C_CAPABILITIES.map((c) =>
    surfaceClassCCauseCopy(c),
  );

  function sentenceLiteralViolation(
    rel: string,
    source: string,
  ): string | false {
    if (
      rel === "lib/web3/surface-support.ts" ||
      rel === "lib/messaging/snapshot-ui.ts"
    ) {
      return false;
    }
    for (const sentence of SUPPORT_SENTENCES) {
      if (source.includes(JSON.stringify(sentence))) {
        return `re-inlined SurfaceSupportCause sentence: ${sentence}`;
      }
    }
    for (const sentence of CLASS_C_SENTENCES) {
      if (source.includes(JSON.stringify(sentence))) {
        return `re-inlined class-C sentence: ${sentence}`;
      }
    }
    return false;
  }

  it("no second support or class-C sentence literals in product", () => {
    assertCleanProductScan(scanProductSources(sentenceLiteralViolation));
  });

  it("(c) plant: re-inline is red then green", () => {
    const planted = `const x = ${JSON.stringify(surfaceSupportCauseCopy("product_owner_owed"))};`;
    const hit = sentenceLiteralViolation("components/shell/app-top-nav.tsx", planted);
    assert.equal(
      hit,
      `re-inlined SurfaceSupportCause sentence: ${surfaceSupportCauseCopy("product_owner_owed")}`,
    );
    const plantedC = `const y = ${JSON.stringify(surfaceClassCCauseCopy("messaging_session"))};`;
    const hitC = sentenceLiteralViolation(
      "components/shell/app-top-nav.tsx",
      plantedC,
    );
    assert.equal(
      hitC,
      `re-inlined class-C sentence: ${surfaceClassCCauseCopy("messaging_session")}`,
    );
    assertCleanProductScan(scanProductSources(sentenceLiteralViolation));
  });

  it("class-C sentences name the family, never on this network", () => {
    for (const cap of SURFACE_CLASS_C_CAPABILITIES) {
      const sentence = surfaceClassCCauseCopy(cap);
      assert.ok(sentence.length > 0, cap);
      assert.ok(
        !sentence.toLowerCase().includes("on this network"),
        `${cap}: ${sentence}`,
      );
    }
  });
});

describe("typed facts no invent (d)", () => {
  function numericDefaultViolation(
    rel: string,
    source: string,
  ): string | false {
    if (
      rel !== "hooks/use-pending-claims.ts" &&
      rel !== "hooks/use-unread-notifications-count.ts" &&
      rel !== "lib/claims/pending-claims-fact.ts" &&
      rel !== "lib/notifications/unread-alerts-fact.ts"
    ) {
      return false;
    }
    if (/total\s*:\s*query\.data\?\.total\s*\?\?\s*0/.test(source)) {
      return `numeric default ?? 0 on pending-claims fact: ${rel}`;
    }
    if (/unreadCount\s*\?\?\s*0/.test(source) || /count\s*\?\?\s*0/.test(source)) {
      return `numeric default ?? 0 on unread fact: ${rel}`;
    }
    return false;
  }

  it("pending-claims and unread owners have no ?? 0 invent", () => {
    assertCleanProductScan(scanProductSources(numericDefaultViolation));
  });

  it("(d) plant: ?? 0 is red then green", () => {
    const planted =
      "return { total: query.data?.total ?? 0, claims: query.data?.claims ?? [] };";
    const hit = numericDefaultViolation("hooks/use-pending-claims.ts", planted);
    assert.equal(
      hit,
      "numeric default ?? 0 on pending-claims fact: hooks/use-pending-claims.ts",
    );
    assertCleanProductScan(scanProductSources(numericDefaultViolation));
  });
});

describe("census rows pending_claims + kar_pro_min_stake", () => {
  it("counts: total 97, A 85, B 8, C 4", () => {
    const caps = Object.keys(SURFACE_SUPPORT_TABLE) as SurfaceCapability[];
    assert.equal(caps.length, 97);
    let a = 0;
    let b = 0;
    let c = 0;
    for (const cap of caps) {
      const cls = surfaceClassOf(cap);
      if (cls === "A") a += 1;
      else if (cls === "B") b += 1;
      else c += 1;
    }
    assert.equal(a, 85);
    assert.equal(b, 8);
    assert.equal(c, 4);
  });

  it("SVM cells are product_owner_owed", () => {
    for (const cap of ["pending_claims", "kar_pro_min_stake"] as const) {
      const cell = surfaceSupport(cap, SOLANA_NS);
      assert.ok(!("unresolved" in cell) && !cell.supported);
      if (!("unresolved" in cell) && !cell.supported) {
        assert.equal(cell.cause, "product_owner_owed");
      }
    }
  });
});
