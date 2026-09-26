/**
 * Surface admission — census then session (S8-D4 account chrome + 2e amend).
 *
 * Guards (RED plant → green):
 * (a) requireEvmSession in chrome set only on explicit allowlist with reasons
 * (b) surfaceSupport( product callers only on allowlist with reasons
 * (c) second copy of SurfaceSupportCause or class-C sentence
 * (d) numeric invent feeding chainId / namespace / count / total
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
} from "@/lib/web3/surface-support";
import {
  assertCleanProductScan,
  scanProductSources,
  type ProductSourceScanResult,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

/** Measured chrome set for requireEvmSession allowlist. */
const CHROME_REQUIRE_EVM_FILES = [
  "components/shell/app-top-nav.tsx",
  "components/shell/mobile-bottom-nav.tsx",
  "hooks/use-show-become-karpro.ts",
  "components/notifications/notifications-unread-badge.tsx",
  "components/notifications/notifications-shell.tsx",
  "components/claims/claims-pending-banner.tsx",
  "components/identity/identity-header.tsx",
  "components/profile/profile-page.tsx",
  "components/profile/profile-verifier-stats-band.tsx",
  "components/profile/profile-action-banner.tsx",
  "components/kar-pro/kar-pro-page-content.tsx",
  "hooks/use-is-profile-owner.ts",
] as const;

/**
 * Chrome files allowed to call requireEvmSession — each entry must state why.
 * Connectedness itself must never use it.
 */
const CHROME_REQUIRE_EVM_ALLOWLIST: ReadonlyArray<{
  file: string;
  reason: string;
}> = [
  {
    file: "components/notifications/notifications-shell.tsx",
    reason: "Nostr key bootstrap (class-C nostr_identity)",
  },
  {
    file: "components/profile/profile-page.tsx",
    reason: "Owner bridge-transit hydrate needs session EVM address",
  },
];

const SURFACE_SUPPORT_CALLER_ALLOWLIST: ReadonlyArray<{
  file: string;
  reason: string;
}> = [
  {
    file: "lib/web3/surface-admission.ts",
    reason: "Sole census→session composer",
  },
  {
    file: "lib/passport/create-passport-surface.ts",
    reason: "Support-only where-available network listing (no session)",
  },
];

const NUMERIC_INVENT_SCAN_ROOTS = [
  "app",
  "components",
  "hooks",
  "lib/verifier/active-verifier-fact.ts",
  "lib/claims/pending-claims-fact.ts",
  "lib/notifications/unread-alerts-fact.ts",
  "lib/web3/surface-admission.ts",
] as const;

function chromeRequireEvmViolation(
  rel: string,
  source: string,
): string | false {
  if (!(CHROME_REQUIRE_EVM_FILES as readonly string[]).includes(rel)) {
    return false;
  }
  if (!/\brequireEvmSession\b/.test(source)) return false;
  const allowed = CHROME_REQUIRE_EVM_ALLOWLIST.some((e) => e.file === rel);
  if (allowed) return false;
  return `chrome requireEvmSession outside allowlist: ${rel}`;
}

function surfaceSupportCallerViolation(
  rel: string,
  source: string,
): string | false {
  if (
    !rel.startsWith("app/") &&
    !rel.startsWith("components/") &&
    !rel.startsWith("hooks/") &&
    !rel.startsWith("lib/")
  ) {
    return false;
  }
  // Definition owner — not a caller. Chokepoint rule prose may quote the name.
  if (rel === "lib/web3/surface-support.ts") return false;
  if (rel === "lib/architecture/chokepoints.ts") return false;
  const importsOwner =
    /import\s*\{[^}]*\bsurfaceSupport\b[^}]*\}\s*from\s*["'][^"']*surface-support["']/.test(
      source,
    );
  if (!importsOwner) return false;
  if (!/\bsurfaceSupport\s*\(/.test(source)) return false;
  const allowed = SURFACE_SUPPORT_CALLER_ALLOWLIST.some((e) => e.file === rel);
  if (allowed) return false;
  return `surfaceSupport( product caller outside allowlist: ${rel}`;
}

/**
 * Numeric invent feeding chainId / namespace / count / total — by property fed,
 * not by variable spelling.
 */
function numericInventViolation(
  rel: string,
  source: string,
): string | false {
  const inScope =
    rel.startsWith("app/") ||
    rel.startsWith("components/") ||
    rel.startsWith("hooks/") ||
    (NUMERIC_INVENT_SCAN_ROOTS as readonly string[]).includes(rel);
  if (!inScope) return false;

  // Property-fed invent only (not `total ===` identity / empty browse envelopes).
  const patterns: Array<{ re: RegExp; label: string }> = [
    {
      re: /chainId\s*:\s*[^,\n}]*\?\?\s*0\b/,
      label: "chainId fed by ?? 0",
    },
    {
      re: /namespace\s*:\s*[^,\n}]*\?\?\s*0\b/,
      label: "namespace fed by ?? 0",
    },
    {
      re: /\btotal\s*:\s*[^,\n}]*\?\?\s*0\b/,
      label: "total fed by ?? 0",
    },
    {
      re: /\bcount\s*:\s*[^,\n}]*\?\?\s*0\b/,
      label: "count fed by ?? 0",
    },
    {
      re: /\bclaims\s*:\s*[^,\n}]*\?[^,\n}]*:\s*0\b/,
      label: "claims fed by ternary : 0",
    },
    {
      re: /\bclaims\s*:\s*[^,\n}]*\?\?\s*0\b/,
      label: "claims fed by ?? 0",
    },
  ];
  for (const { re, label } of patterns) {
    if (re.test(source)) {
      return `numeric invent (${label}): ${rel}`;
    }
  }
  return false;
}

function assertThrowsAssertionError(
  fn: () => void,
  expectedMessage: string,
): void {
  assert.throws(
    fn,
    (err: unknown) => {
      assert.ok(err instanceof assert.AssertionError);
      assert.equal(err.message, expectedMessage);
      return true;
    },
  );
}

function assertPlantedViolation(hit: string | false, expectedMessage: string): void {
  assert.equal(hit, expectedMessage);
  assertThrowsAssertionError(() => {
    throw new assert.AssertionError({ message: expectedMessage });
  }, expectedMessage);
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

  it("available EVM packs address and chainId; ForCapability maps without re-check", () => {
    const admission = admitSurface(EVM_ACCOUNT, "set_passport_uri", 84532);
    assert.equal(admission.status, "available");
    if (admission.status === "available" && admission.family === "evm") {
      assert.equal(admission.address, EVM_ACCOUNT.address);
      assert.equal(admission.chainId, 84532);
    }
    const write = txWriteAvailabilityForCapability(
      EVM_ACCOUNT,
      "set_passport_uri",
      84532,
    );
    assert.deepEqual(write, {
      available: true,
      vm: "evm",
      walletChainId: 84532,
    });
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
});

describe("chrome requireEvmSession allowlist (a)", () => {
  it("every allowlist entry has a reason and is in the chrome set", () => {
    for (const entry of CHROME_REQUIRE_EVM_ALLOWLIST) {
      assert.ok(entry.reason.length > 0, entry.file);
      assert.ok(
        (CHROME_REQUIRE_EVM_FILES as readonly string[]).includes(entry.file),
        entry.file,
      );
    }
  });

  it("measured chrome set: requireEvmSession only on allowlist", () => {
    const scan = scanProductSources(chromeRequireEvmViolation);
    assertCleanProductScan(scan);
    assert.ok(scan.filesRead >= CHROME_REQUIRE_EVM_FILES.length);
  });

  it("(a) plant: bare requireEvmSession in chrome is red then green", () => {
    const planted =
      'import { requireEvmSession } from "@/hooks/use-active-account";\nconst evm = requireEvmSession(account);\n';
    const rel = "hooks/use-show-become-karpro.ts";
    assertPlantedViolation(
      chromeRequireEvmViolation(rel, planted),
      `chrome requireEvmSession outside allowlist: ${rel}`,
    );
    assertCleanProductScan(scanProductSources(chromeRequireEvmViolation));
  });
});

describe("surfaceSupport caller allowlist (b)", () => {
  it("every allowlist entry has a reason", () => {
    for (const entry of SURFACE_SUPPORT_CALLER_ALLOWLIST) {
      assert.ok(entry.reason.length > 0, entry.file);
      assert.ok(fs.existsSync(path.join(ROOT, entry.file)), entry.file);
    }
  });

  it("product surfaceSupport( callers are only the allowlisted owners", () => {
    const scan = scanProductSources(surfaceSupportCallerViolation);
    assertCleanProductScan(scan);
  });

  it("(b) plant: new surfaceSupport( caller is red then green", () => {
    const planted =
      'import { surfaceSupport } from "@/lib/web3/surface-support";\nsurfaceSupport("pending_claims", 84532);\n';
    const rel = "hooks/use-pending-claims.ts";
    assertPlantedViolation(
      surfaceSupportCallerViolation(rel, planted),
      `surfaceSupport( product caller outside allowlist: ${rel}`,
    );
    assertCleanProductScan(scanProductSources(surfaceSupportCallerViolation));
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
    assertCleanProductScan(scanProductSources(sentenceLiteralViolation));
  });

  it("class-C sentences name the family and never on this network", () => {
    for (const cap of SURFACE_CLASS_C_CAPABILITIES) {
      const sentence = surfaceClassCCauseCopy(cap);
      assert.match(
        sentence,
        /Ethereum wallet/,
        `${cap} must name the wallet family: ${sentence}`,
      );
      assert.ok(
        !sentence.toLowerCase().includes("on this network"),
        `${cap}: ${sentence}`,
      );
    }
  });
});

describe("numeric invent ban (d)", () => {
  it("no chainId/namespace/count/total invent via ?? 0 or ternary : 0 in scope", () => {
    const scan = scanProductSources(numericInventViolation);
    assertCleanProductScan(scan);
  });

  it("(d) plant: chainId ?? 0 is red then green", () => {
    const planted =
      "const { fact } = useActiveVerifierFact({ chainId: targetChainId ?? 0 });\n";
    const rel = "hooks/use-show-become-karpro.ts";
    assertPlantedViolation(
      numericInventViolation(rel, planted),
      `numeric invent (chainId fed by ?? 0): ${rel}`,
    );
    assertCleanProductScan(scanProductSources(numericInventViolation));
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

/** Exported for report — filesRead derivation. */
export function reportAdmissionGuardScans(): {
  a: ProductSourceScanResult;
  b: ProductSourceScanResult;
  d: ProductSourceScanResult;
} {
  return {
    a: scanProductSources(chromeRequireEvmViolation),
    b: scanProductSources(surfaceSupportCallerViolation),
    d: scanProductSources(numericInventViolation),
  };
}
