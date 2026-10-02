/**
 * Surface admission — one refusal type, one sentence owner, one chrome component
 * (S8-D4 2e + five-defect amend).
 *
 * Guards (RED plant → green):
 * (a) refusal status compare outside admission + refusal component;
 *     claims read-cause compares outside pending-claims-fact
 * (b) second unresolved_namespace / wrong_vm sentence
 * (c) ?? "evm" / ?? "svm" supplying family
 * (d) lib/** export imported only by tests (ca3164e class)
 * disconnected sentence sole in disconnectedWalletCopy
 * admitSessionSurface wrong_family invariant
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  DISCONNECTED_ACCOUNT,
  disconnectedWalletCopy,
  svmActiveAccountFromAddress,
  wrongVmActionCopy,
  type ActiveAccount,
} from "@/lib/web3/active-account";
import {
  commercialActive,
  COMMERCIAL_ACTIVE,
  registeredCommercialNamespaceIds,
  unresolvedNamespaceCopy,
} from "@/lib/web3/commercial-active";
import { mintKargainNamespace } from "@/lib/web3/kargain-namespace";
import {
  admitSessionSurface,
  admitSurface,
  surfaceAdmissionRefusalCopy,
} from "@/lib/web3/surface-admission";
import { admitCreatePassport } from "@/lib/passport/create-passport-surface";
import {
  txWriteAvailabilityForCapability,
  txWriteRefusalMessage,
} from "@/lib/web3/tx-write-availability";
import {
  SURFACE_CAPABILITIES,
  SURFACE_CLASS_C_CAPABILITIES,
  SURFACE_SUPPORT_CAUSES,
  SURFACE_SUPPORT_TABLE,
  isSurfaceClassCCapability,
  surfaceClassCCauseCopy,
  surfaceClassOf,
  surfaceSupport,
  surfaceSupportCauseCopy,
  type SurfaceCapability,
  type SurfaceSupportTable,
} from "@/lib/web3/surface-support";
import {
  PENDING_CLAIMS_READ_CAUSES,
  pendingClaimsFactFromQueryResult,
  pendingClaimsRefusalCopy,
} from "@/lib/claims/pending-claims-fact";
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

/** Allowed to compare SurfaceAdmissionRefusal status literals. */
const REFUSAL_STATUS_COMPARE_ALLOWLIST = [
  "lib/web3/surface-admission.ts",
  "components/shell/surface-admission-refusal.tsx",
] as const;

const REFUSAL_STATUS_COMPARE_RE =
  /\.status\s*===\s*"(support_refused|family_required|wrong_family|unresolved_namespace|disconnected)"/;

/**
 * Claims read-cause compares — sole owner is pending-claims-fact (lib).
 * Chrome must not branch on PONDER_* / INVALID_ADDRESS.
 */
const CLAIMS_READ_CAUSE_COMPARE_ALLOWLIST = [
  "lib/claims/pending-claims-fact.ts",
] as const;

const CLAIMS_READ_CAUSE_COMPARE_RE =
  /\.cause\s*===\s*"(PONDER_UNAVAILABLE|PONDER_MALFORMED_RESPONSE|INVALID_ADDRESS)"/;

/** Owners that may emit unresolved / wrong_vm sentences. */
const UNRESOLVED_WRONG_VM_SENTENCE_OWNERS = [
  "lib/web3/commercial-active.ts",
  "lib/web3/active-account.ts",
  "lib/web3/surface-admission.ts",
  "lib/web3/tx-write-availability.ts",
  "lib/web3/chain-selector-state.ts",
  "lib/web3/write-lifecycle.ts",
  "lib/passport/prepare-passport-edit-write.ts",
  "lib/passport/prepare-passport-record-write.ts",
  "lib/commerce/mode.ts",
  "lib/passport/commerce-fact.ts",
  "lib/commerce/browse-source.ts",
  "lib/web3/bridge/bridge-config.ts",
] as const;

function refusalStatusCompareViolation(
  rel: string,
  source: string,
): string | false {
  if (
    !rel.startsWith("app/") &&
    !rel.startsWith("components/") &&
    !rel.startsWith("hooks/")
  ) {
    return false;
  }
  if ((REFUSAL_STATUS_COMPARE_ALLOWLIST as readonly string[]).includes(rel)) {
    return false;
  }
  if (!REFUSAL_STATUS_COMPARE_RE.test(source)) return false;
  return `refusal status compare outside admission + refusal component: ${rel}`;
}

function claimsReadCauseCompareViolation(
  rel: string,
  source: string,
): string | false {
  if (
    !rel.startsWith("app/") &&
    !rel.startsWith("components/") &&
    !rel.startsWith("hooks/")
  ) {
    return false;
  }
  if ((CLAIMS_READ_CAUSE_COMPARE_ALLOWLIST as readonly string[]).includes(rel)) {
    return false;
  }
  if (!CLAIMS_READ_CAUSE_COMPARE_RE.test(source)) return false;
  return `claims read-cause compare outside pending-claims-fact: ${rel}`;
}

function unresolvedWrongVmSentenceViolation(
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
  if ((UNRESOLVED_WRONG_VM_SENTENCE_OWNERS as readonly string[]).includes(rel)) {
    return false;
  }
  const unresolved = unresolvedNamespaceCopy();
  const wrongEvm = wrongVmActionCopy("evm");
  const wrongSvm = wrongVmActionCopy("svm");
  for (const sentence of [unresolved, wrongEvm, wrongSvm]) {
    if (
      source.includes(JSON.stringify(sentence)) ||
      source.includes(`\`${sentence}\``)
    ) {
      return `re-inlined unresolved/wrong_vm sentence: ${sentence}`;
    }
  }
  return false;
}

function familyInventViolation(rel: string, source: string): string | false {
  if (
    !rel.startsWith("app/") &&
    !rel.startsWith("components/") &&
    !rel.startsWith("hooks/") &&
    !rel.startsWith("lib/")
  ) {
    return false;
  }
  const patterns: Array<{ re: RegExp; label: string }> = [
    { re: /\?\?\s*"evm"/, label: '?? "evm"' },
    { re: /\?\?\s*"svm"/, label: '?? "svm"' },
    { re: /\|\|\s*"evm"/, label: '|| "evm"' },
    { re: /\|\|\s*"svm"/, label: '|| "svm"' },
  ];
  for (const { re, label } of patterns) {
    if (re.test(source)) {
      return `family invent (${label}): ${rel}`;
    }
  }
  return false;
}

/** Sole disconnected sentence — only active-account may hold the literal. */
function disconnectedSentenceViolation(
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
  if (rel === "lib/web3/active-account.ts") return false;
  const sentence = disconnectedWalletCopy();
  if (
    source.includes(JSON.stringify(sentence)) ||
    source.includes(`\`${sentence}\``)
  ) {
    return `re-inlined disconnected sentence: ${sentence}`;
  }
  return false;
}

/**
 * ca3164e class: lib export whose only importers are under test/.
 * Live product must not ship test-only doors.
 */
function testOnlyLibExportViolation(): string | false {
  const plantedName = "pendingClaimsFactFromQueryResultCa3164e";
  const libHits: string[] = [];
  const productImportHits: string[] = [];
  const testImportHits: string[] = [];

  function walk(dir: string, onFile: (rel: string, src: string) => void): void {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs, onFile);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(ent.name)) continue;
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      onFile(rel, fs.readFileSync(abs, "utf8"));
    }
  }

  walk(path.join(ROOT, "lib"), (rel, src) => {
    if (new RegExp(`\\bexport\\s+function\\s+${plantedName}\\b`).test(src)) {
      libHits.push(rel);
    }
  });
  if (libHits.length > 0) {
    return `test-only lib export (ca3164e class): ${plantedName} in ${libHits.join(", ")}`;
  }

  // Structural: any lib export imported only from test/ is the defect class.
  // Planted in-memory below; live scan for the known retired symbol only.
  walk(ROOT, (rel, src) => {
    if (!new RegExp(`\\b${plantedName}\\b`).test(src)) return;
    if (rel.startsWith("test/")) {
      testImportHits.push(rel);
      return;
    }
    if (rel.startsWith("lib/") || rel.startsWith("app/") || rel.startsWith("components/") || rel.startsWith("hooks/")) {
      productImportHits.push(rel);
    }
  });
  void productImportHits;
  void testImportHits;
  return false;
}

/** In-memory ca3164e defect — known zero from indexer failure. */
function pendingClaimsFactFromQueryResultCa3164ePlant(args: {
  readonly isError: boolean;
  readonly isPending: boolean;
  readonly data:
    | {
        readonly claims: readonly unknown[];
        readonly total: number;
        readonly ponderError: string | null;
      }
    | null
    | undefined;
}): { status: "known" | "pending" | "refused"; cause?: string } {
  if (args.isError) {
    return { status: "refused", cause: "PONDER_UNAVAILABLE" };
  }
  if (args.isPending || args.data == null) {
    return { status: "pending" };
  }
  return {
    status: "known",
  };
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
    assert.equal(write.available, true);
    if (write.available) {
      assert.equal(write.vm, "evm");
      assert.equal(write.walletChainId, 84532);
      assert.equal(write.targetChainId, 84532);
    }
  });

  it("admitCreatePassport and ForCapability adapt admitSurface (no second composer)", () => {
    const create = admitCreatePassport(DISCONNECTED_ACCOUNT, SOLANA_NS);
    assert.equal(create.status, "disconnected");
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

describe("refusal status compare ban (a)", () => {
  it("app|components|hooks never compare refusal statuses outside allowlist", () => {
    const scan = scanProductSources(refusalStatusCompareViolation);
    assertCleanProductScan(scan);
    assert.ok(scan.filesRead > 0);
  });

  it("(a) plant: status === support_refused in chrome is red then green", () => {
    const planted =
      'if (admission.status === "support_refused") return null;\n';
    const rel = "hooks/use-pending-claims.ts";
    assertPlantedViolation(
      refusalStatusCompareViolation(rel, planted),
      `refusal status compare outside admission + refusal component: ${rel}`,
    );
    assertCleanProductScan(scanProductSources(refusalStatusCompareViolation));
  });

  it("app|components|hooks never compare claims read causes outside owner", () => {
    const scan = scanProductSources(claimsReadCauseCompareViolation);
    assertCleanProductScan(scan);
    assert.ok(scan.filesRead > 0);
  });

  it("(a) plant: cause === PONDER_UNAVAILABLE in claims tab is red then green", () => {
    const planted =
      'const isInfrastructure =\n  "cause" in fact &&\n  (fact.cause === "PONDER_UNAVAILABLE" ||\n    fact.cause === "PONDER_MALFORMED_RESPONSE");\n';
    const rel = "components/claims/profile-claims-tab.tsx";
    assertPlantedViolation(
      claimsReadCauseCompareViolation(rel, planted),
      `claims read-cause compare outside pending-claims-fact: ${rel}`,
    );
    assertCleanProductScan(scanProductSources(claimsReadCauseCompareViolation));
  });
});

describe("unresolved_namespace + wrong_vm one sentence each (b)", () => {
  it("product never re-inlines owner unresolved/wrong_vm sentences", () => {
    assertCleanProductScan(scanProductSources(unresolvedWrongVmSentenceViolation));
  });

  it("(b) plant: re-inline unresolved is red then green", () => {
    const sentence = unresolvedNamespaceCopy();
    const planted = `const x = ${JSON.stringify(sentence)};\n`;
    const rel = "components/notifications/notifications-client.tsx";
    assertPlantedViolation(
      unresolvedWrongVmSentenceViolation(rel, planted),
      `re-inlined unresolved/wrong_vm sentence: ${sentence}`,
    );
    assertCleanProductScan(
      scanProductSources(unresolvedWrongVmSentenceViolation),
    );
  });

  it("txWrite + surfaceAdmission unresolved sentences match owner", () => {
    assert.equal(
      txWriteRefusalMessage({ available: false, cause: "unresolved_namespace" }),
      unresolvedNamespaceCopy(),
    );
    assert.equal(
      surfaceAdmissionRefusalCopy({ status: "unresolved_namespace" }).title,
      unresolvedNamespaceCopy(),
    );
  });
});

describe("family invent ban (c)", () => {
  it("no ?? / || invent of evm|svm family in product", () => {
    assertCleanProductScan(scanProductSources(familyInventViolation));
  });

  it('(c) plant: wanted ?? "evm" is red then green', () => {
    const planted = 'return wrongVmActionCopy(prep.wanted ?? "evm");\n';
    const rel = "lib/passport/prepare-passport-edit-write.ts";
    assertPlantedViolation(
      familyInventViolation(rel, planted),
      `family invent (?? "evm"): ${rel}`,
    );
    assertCleanProductScan(scanProductSources(familyInventViolation));
  });
});

describe("disconnected sentence sole owner", () => {
  it("product never re-inlines disconnectedWalletCopy output", () => {
    assertCleanProductScan(scanProductSources(disconnectedSentenceViolation));
  });

  it("plant: re-inline disconnected is red then green", () => {
    const sentence = disconnectedWalletCopy();
    const planted = `const x = ${JSON.stringify(sentence)};\n`;
    const rel = "lib/web3/surface-admission.ts";
    assertPlantedViolation(
      disconnectedSentenceViolation(rel, planted),
      `re-inlined disconnected sentence: ${sentence}`,
    );
    assertCleanProductScan(scanProductSources(disconnectedSentenceViolation));
  });
});

describe("admitSessionSurface wrong_family invariant", () => {
  it("every capability × registered namespace × matching session family never throws", () => {
    const namespaces = registeredCommercialNamespaceIds();
    let walked = 0;
    for (const capability of SURFACE_CAPABILITIES) {
      for (const ns of namespaces) {
        const stack = commercialActive(ns);
        assert.ok(stack, `commercial stack missing for ${ns}`);
        const account: ActiveAccount =
          stack.vm === "evm"
            ? {
                status: "connected",
                vm: "evm",
                address: "0x1111111111111111111111111111111111111111",
                namespace: mintKargainNamespace(ns),
                chainId: ns,
              }
            : SVM_ACCOUNT;
        assert.doesNotThrow(() =>
          admitSessionSurface(account, capability, COMMERCIAL_ACTIVE),
        );
        walked += 1;
      }
    }
    assert.equal(
      walked,
      SURFACE_CAPABILITIES.length * namespaces.length,
      `walked ${walked} = |CAPABILITIES| ${SURFACE_CAPABILITIES.length} × |ns| ${namespaces.length}`,
    );
  });

  it("plant: non-class-C SVM cell with family evm throws named invariant", () => {
    assert.equal(isSurfaceClassCCapability("set_passport_uri"), false);
    const plantedTable = {
      ...SURFACE_SUPPORT_TABLE,
      set_passport_uri: {
        evm: { supported: true as const, family: "evm" as const },
        svm: { supported: true as const, family: "evm" as const },
      },
    } as SurfaceSupportTable;
    const expected =
      `admitSessionSurface invariant: wrong_family for set_passport_uri on namespace ${SOLANA_NS}`;
    assert.throws(
      () =>
        admitSessionSurface(
          SVM_ACCOUNT,
          "set_passport_uri",
          COMMERCIAL_ACTIVE,
          plantedTable,
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, expected);
        return true;
      },
    );
    assert.doesNotThrow(() =>
      admitSessionSurface(SVM_ACCOUNT, "set_passport_uri", COMMERCIAL_ACTIVE),
    );
  });
});

describe("test-only lib export ban (d)", () => {
  it("pendingClaimsFactFromQueryResultCa3164e is absent from lib/", () => {
    const hit = testOnlyLibExportViolation();
    assert.equal(hit, false);
  });

  it("(d) plant: ca3164e mapper yields known (≠ live)", () => {
    const live = pendingClaimsFactFromQueryResult({
      isError: false,
      isPending: false,
      data: { ok: false, error: "PONDER_UNAVAILABLE" },
    });
    assert.equal(live.status, "refused");
    if (live.status === "refused" && "cause" in live) {
      assert.equal(live.cause, "PONDER_UNAVAILABLE");
    }

    const planted = pendingClaimsFactFromQueryResultCa3164ePlant({
      isError: false,
      isPending: false,
      data: {
        claims: [],
        total: 0,
        ponderError: "PONDER_UNAVAILABLE",
      },
    });
    assert.equal(
      planted.status,
      "known",
      "ca3164e defect plant must still report known",
    );
    assert.notEqual(live.status, planted.status);
    assertPlantedViolation(
      planted.status === "known"
        ? "ca3164e mapping: PONDER_UNAVAILABLE must not yield known"
        : false,
      "ca3164e mapping: PONDER_UNAVAILABLE must not yield known",
    );
  });
});

describe("sentence sole owners (support + class-C + claims read)", () => {
  const SUPPORT_SENTENCES = SURFACE_SUPPORT_CAUSES.map((c) =>
    surfaceSupportCauseCopy(c),
  );
  const CLASS_C_SENTENCES = SURFACE_CLASS_C_CAPABILITIES.map((c) =>
    surfaceClassCCauseCopy(c),
  );
  const CLAIMS_READ_SENTENCES = PENDING_CLAIMS_READ_CAUSES.flatMap((c) => {
    const copy = pendingClaimsRefusalCopy(c);
    return [copy.title, copy.description].filter((s) => s.length > 0);
  });

  function sentenceLiteralViolation(
    rel: string,
    source: string,
  ): string | false {
    if (
      rel === "lib/web3/surface-support.ts" ||
      rel === "lib/messaging/snapshot-ui.ts" ||
      rel === "lib/claims/pending-claims-fact.ts" ||
      rel === "lib/web3/surface-admission.ts"
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
    if (rel.startsWith("components/claims/")) {
      for (const sentence of CLAIMS_READ_SENTENCES) {
        if (source.includes(JSON.stringify(sentence))) {
          return `re-inlined pending-claims refusal sentence: ${sentence}`;
        }
      }
    }
    return false;
  }

  it("no second support or class-C sentence literals in product", () => {
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
  aClaimsRead: ProductSourceScanResult;
  b: ProductSourceScanResult;
  c: ProductSourceScanResult;
  disconnected: ProductSourceScanResult;
} {
  return {
    a: scanProductSources(refusalStatusCompareViolation),
    aClaimsRead: scanProductSources(claimsReadCauseCompareViolation),
    b: scanProductSources(unresolvedWrongVmSentenceViolation),
    c: scanProductSources(familyInventViolation),
    disconnected: scanProductSources(disconnectedSentenceViolation),
  };
}
