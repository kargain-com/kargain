/**
 * Error coverage policy — every declared custom error must have a suite `revertsWith`.
 *
 * Money-path outcome testing (modes inherit this): where a rule states what money does
 * (split / fee / payout), tests assert **amounts / outcomes** under adversarial storage
 * or inputs. Do not lock money invariants by scanning source identifiers — rename and
 * extraction defeat that silently. This suite and name-truth remain necessary but are
 * insufficient for branch inertness (see consignment-base direct floor poison assert).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS_DIR = path.join(ROOT, "contracts");
const SVM_KARGAIN_ERRORS_RS = path.join(
  ROOT,
  "svm/crates/kargain-errors/src/lib.rs",
);

/**
 * D-16 SVM-only protocol errors — present on `KargainError`, never as Solidity
 * `error` declarations. Keep small; growth means the EVM/SVM split is drifting.
 */
export const SVM_ONLY_ERROR_NAMES = [
  "ComposeRequired",
  "ComposeUndecodable",
] as const;

/**
 * Shared-crate unit-test coverage floor (Hardhat `revertsWith` analog).
 * Asserts must appear inside `#[cfg(test)]` modules under these owners.
 */
export const SVM_ERROR_UNIT_COVERAGE_REQUIRED = [
  "WrongValue",
  "ComposeRequired",
  "ComposeUndecodable",
  "NoClaim",
] as const;

/** Sole crate sources allowed to assert protocol error names in unit tests. */
export const SVM_ERROR_ASSERT_OWNERS: readonly string[] = [
  "svm/crates/kargain-errors/src/lib.rs",
  "svm/crates/kargain-onft-codec/src/lib.rs",
  "svm/crates/kargain-claimable-payouts/src/lib.rs",
  "svm/crates/kargain-bonded-challenge/src/lib.rs",
] as const;

export type ErrorCoverageEntry = {
  contract: string;
  errorSource: string;
  suiteFiles: string[];
};

/** Production contracts → error declaration source + suites that count for coverage. */
export const ERROR_COVERAGE_REGISTRY: readonly ErrorCoverageEntry[] = [
  {
    contract: "KarPassport",
    errorSource: "KarPassport.sol",
    suiteFiles: [
      "KarPassportV2.test.ts",
      "KarPassportEncumbrance.test.ts",
      "kargain.contracts.test.ts",
      "KarPassportBridge.test.ts",
    ],
  },
  {
    contract: "KarProPass",
    errorSource: "KarProPass.sol",
    suiteFiles: ["kargain.contracts.test.ts"],
  },
  {
    contract: "KarProStaking",
    errorSource: "KarProStaking.sol",
    suiteFiles: ["kargain.contracts.test.ts"],
  },
  {
    contract: "KarPassportBridgeGateway",
    errorSource: "KarPassportBridgeGateway.sol",
    suiteFiles: ["KarPassportBridgeGateway.test.ts", "KarPassportBridge.test.ts"],
  },
  {
    contract: "Timelock48h",
    errorSource: "Timelock48h.sol",
    suiteFiles: ["Timelock48h.test.ts"],
  },
  {
    contract: "FixedPriceConsignment",
    errorSource: "FixedPriceConsignment.sol",
    suiteFiles: ["fixed-price/FixedPriceConsignment.test.ts"],
  },
  {
    contract: "AscendingConsignment",
    errorSource: "AscendingConsignment.sol",
    suiteFiles: ["ascending/AscendingConsignment.test.ts"],
  },
] as const;

/**
 * Abstract lib primitives under contracts/lib/ that own custom errors.
 * Completeness vs directory scan: every contracts/lib/*.sol is here or in LIB_ERROR_FOLDED.
 */
export const LIB_ERROR_COVERAGE_REGISTRY: readonly ErrorCoverageEntry[] = [
  {
    contract: "BondedChallenge",
    errorSource: "lib/BondedChallenge.sol",
    suiteFiles: ["bonded-challenge/BondedChallenge.test.ts"],
  },
  {
    contract: "ConsignmentBase",
    errorSource: "lib/ConsignmentBase.sol",
    suiteFiles: ["consignment-base/ConsignmentBase.test.ts"],
  },
  {
    contract: "Mandate",
    errorSource: "lib/Mandate.sol",
    suiteFiles: ["mandate-recall/MandateRecall.test.ts"],
  },
  {
    contract: "Recall",
    errorSource: "lib/Recall.sol",
    suiteFiles: ["mandate-recall/MandateRecall.test.ts"],
  },
] as const;

/**
 * Lib sources whose errors are exercised only via money-path parents (not standalone suites).
 */
export const LIB_ERROR_FOLDED: readonly string[] = [
  "ClaimablePayouts",
  "Erc20Admission",
  /** Linked into Ascending via DELEGATECALL — errors exercised by Ascending Hardhat suite. */
  "AscendingHoldLib",
  "AscendingOpenLib",
  /** Shared layouts only — no custom errors. */
  "AscendingTypes",
] as const;

const ALL_ERROR_COVERAGE_REGISTRY: readonly ErrorCoverageEntry[] = [
  ...ERROR_COVERAGE_REGISTRY,
  ...LIB_ERROR_COVERAGE_REGISTRY,
];

export type EscapeHatchEntry = {
  contract: string;
  error: string;
  reason: string;
};

/**
 * Permanent exceptions: justified by a property of the code (not fixtures or effort).
 * Must stay empty unless a true untriggerable path is discovered.
 */
export const ERROR_COVERAGE_UNTRIGGERABLE: readonly EscapeHatchEntry[] = [];

/**
 * Declared-and-unreachable defects awaiting a contract fix (not permanent exceptions).
 * Must stay empty when every declared error is either covered or deleted.
 */
export const ERROR_COVERAGE_PENDING_REMOVAL: readonly EscapeHatchEntry[] = [];

const ERROR_DECL_RE = /error\s+([A-Za-z0-9_]+)\s*\(/g;
const REVERTS_WITH_RE = /revertsWith\(\s*["']([A-Za-z0-9_]+)["']\s*\)/g;
/** Named protocol asserts in Rust unit tests (`KargainError` / codec mirror). */
const RUST_ERROR_ASSERT_RE = /\b(?:KargainError|CodecError)::([A-Za-z0-9_]+)/g;
const KARGAIN_ERROR_ENUM_RE = /\b(?:pub\s+)?enum\s+KargainError\b/g;

export type PairStatus = "covered" | "untriggerable" | "pending_removal" | "missing";

export type CoveragePair = {
  contract: string;
  error: string;
  status: PairStatus;
};

/**
 * Extract balanced `{...}` starting at `openBraceIndex` (must point at `{`).
 */
export function extractBalancedBraces(
  source: string,
  openBraceIndex: number,
): { inner: string; end: number } | null {
  if (source[openBraceIndex] !== "{") return null;
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { inner: source.slice(openBraceIndex + 1, i), end: i + 1 };
      }
    }
  }
  return null;
}

/**
 * Typed parser for `enum KargainError { Variant = n, ... }` — variant names only.
 * Requires explicit discriminants (append-only code table).
 */
export function parseKargainErrorEnumNames(rustSource: string): string[] {
  const header = /(?:pub\s+)?enum\s+KargainError\s*\{/.exec(rustSource);
  if (!header || header.index === undefined) {
    throw new Error("KargainError enum not found in Rust source");
  }
  const openIdx = rustSource.indexOf("{", header.index);
  const bal = extractBalancedBraces(rustSource, openIdx);
  if (!bal) throw new Error("KargainError enum body unclosed");
  const names: string[] = [];
  const variantRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\d+/gm;
  let match: RegExpExecArray | null;
  while ((match = variantRe.exec(bal.inner)) !== null) {
    names.push(match[1]!);
  }
  return [...new Set(names)].sort();
}

export function loadKargainErrorEnumNames(): string[] {
  assert.ok(
    fs.existsSync(SVM_KARGAIN_ERRORS_RS),
    `missing sole owner: ${path.relative(ROOT, SVM_KARGAIN_ERRORS_RS)}`,
  );
  return parseKargainErrorEnumNames(fs.readFileSync(SVM_KARGAIN_ERRORS_RS, "utf8"));
}

export function collectAllSolidityCustomErrorNames(): Set<string> {
  const names = new Set<string>();
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "test" || entry.name === "mocks") continue;
        walk(full);
      } else if (entry.name.endsWith(".sol")) {
        for (const n of parseErrorNames(fs.readFileSync(full, "utf8"))) {
          names.add(n);
        }
      }
    }
  }
  walk(CONTRACTS_DIR);
  return names;
}

export function collectRustErrorAssertNames(rustSource: string): Set<string> {
  const names = new Set<string>();
  RUST_ERROR_ASSERT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RUST_ERROR_ASSERT_RE.exec(rustSource)) !== null) {
    names.add(match[1]!);
  }
  return names;
}

/** Only `#[cfg(test)] mod … { … }` bodies count toward SVM unit coverage. */
export function collectRustTestModuleErrorAsserts(rustSource: string): Set<string> {
  const names = new Set<string>();
  const cfgRe = /#\[cfg\(test\)\]\s*mod\s+[A-Za-z0-9_]+\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = cfgRe.exec(rustSource)) !== null) {
    const openIdx = rustSource.indexOf("{", match.index);
    const bal = extractBalancedBraces(rustSource, openIdx);
    if (!bal) continue;
    for (const n of collectRustErrorAssertNames(bal.inner)) names.add(n);
  }
  return names;
}

function listRustSourcesUnder(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "target") continue;
        walk(full);
      } else if (entry.name.endsWith(".rs")) {
        out.push(full);
      }
    }
  }
  walk(dir);
  return out.sort();
}

function listProductionContractSolFiles(): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(CONTRACTS_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".sol")) continue;
    out.push(entry.name.replace(/\.sol$/, ""));
  }
  return out.sort();
}

function listLibContractSolFiles(): string[] {
  const libDir = path.join(CONTRACTS_DIR, "lib");
  const out: string[] = [];
  for (const entry of fs.readdirSync(libDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".sol")) continue;
    out.push(entry.name.replace(/\.sol$/, ""));
  }
  return out.sort();
}

export function parseErrorNames(soliditySource: string): string[] {
  const names: string[] = [];
  ERROR_DECL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ERROR_DECL_RE.exec(soliditySource)) !== null) {
    names.push(match[1]!);
  }
  return [...new Set(names)].sort();
}

export function collectRevertsWithNames(testSource: string): Set<string> {
  const names = new Set<string>();
  REVERTS_WITH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REVERTS_WITH_RE.exec(testSource)) !== null) {
    names.add(match[1]!);
  }
  return names;
}

function escapeKey(contract: string, error: string): string {
  return `${contract}::${error}`;
}

function formatEscapeList(label: string, rows: readonly EscapeHatchEntry[]): string {
  if (rows.length === 0) return `${label}: (empty)`;
  return `${label}:\n${rows.map((r) => `  ${r.contract}.${r.error} — ${r.reason}`).join("\n")}`;
}

export function buildErrorCoverageReport(): {
  pairs: CoveragePair[];
  missing: CoveragePair[];
  matrixText: string;
  untriggerableText: string;
  pendingRemovalText: string;
} {
  const untriggerable = new Set(
    ERROR_COVERAGE_UNTRIGGERABLE.map((e) => escapeKey(e.contract, e.error)),
  );
  const pending = new Set(
    ERROR_COVERAGE_PENDING_REMOVAL.map((e) => escapeKey(e.contract, e.error)),
  );
  const pairs: CoveragePair[] = [];

  for (const entry of ALL_ERROR_COVERAGE_REGISTRY) {
    const sourcePath = path.join(CONTRACTS_DIR, entry.errorSource);
    const source = fs.readFileSync(sourcePath, "utf8");
    let errors = parseErrorNames(source);

    // ClaimablePayouts errors are inherited by the money-moving contracts.
    // Erc20Admission errors apply only where tokens enter (not KarPassport).
    if (entry.contract === "KarPassport" || entry.contract === "KarProStaking") {
      const claimSource = fs.readFileSync(
        path.join(CONTRACTS_DIR, "lib/ClaimablePayouts.sol"),
        "utf8",
      );
      errors = [...new Set([...errors, ...parseErrorNames(claimSource)])].sort();
    }
    if (entry.contract === "KarProStaking") {
      const admissionSource = fs.readFileSync(
        path.join(CONTRACTS_DIR, "lib/Erc20Admission.sol"),
        "utf8",
      );
      // TokenDecimalsUnavailable is reachable only via FixedPriceConsignment / AscendingConsignment
      // requireDecimals — KarProStaking.setStakeToken only calls requireConforming.
      const admissionErrors = parseErrorNames(admissionSource).filter(
        (name) => name !== "TokenDecimalsUnavailable",
      );
      errors = [...new Set([...errors, ...admissionErrors])].sort();
    }

    const exercised = new Set<string>();
    for (const suite of entry.suiteFiles) {
      const suitePath = path.join(ROOT, "test", suite);
      const text = fs.readFileSync(suitePath, "utf8");
      for (const name of collectRevertsWithNames(text)) exercised.add(name);
    }

    for (const error of errors) {
      const key = escapeKey(entry.contract, error);
      let status: PairStatus;
      if (exercised.has(error)) status = "covered";
      else if (untriggerable.has(key)) status = "untriggerable";
      else if (pending.has(key)) status = "pending_removal";
      else status = "missing";
      pairs.push({ contract: entry.contract, error, status });
    }
  }

  const missing = pairs.filter((p) => p.status === "missing");
  const lines = pairs.map((p) => `${p.contract}\t${p.error}\t${p.status}`);
  const matrixText = ["contract\terror\tstatus", ...lines].join("\n");
  return {
    pairs,
    missing,
    matrixText,
    untriggerableText: formatEscapeList("untriggerable", ERROR_COVERAGE_UNTRIGGERABLE),
    pendingRemovalText: formatEscapeList("pending_removal", ERROR_COVERAGE_PENDING_REMOVAL),
  };
}

function assertEscapeEntriesValid(
  label: string,
  rows: readonly EscapeHatchEntry[],
  declared: Map<string, Set<string>>,
) {
  for (const row of rows) {
    const set = declared.get(row.contract);
    assert.ok(set, `${label} contract not in registry: ${row.contract}`);
    assert.ok(
      set!.has(row.error),
      `${label} error ${row.contract}.${row.error} is not declared`,
    );
    assert.ok(row.reason.trim().length > 20, `${label} reason too short for ${row.error}`);
  }
}

describe("error coverage policy", () => {
  it("registers every production contract under contracts/*.sol", () => {
    const production = listProductionContractSolFiles();
    const registered = ERROR_COVERAGE_REGISTRY.map((e) => e.contract).sort();
    assert.deepEqual(
      registered,
      production,
      `ERROR_COVERAGE_REGISTRY must list every production contract. production=${production.join(",")} registered=${registered.join(",")}`,
    );
  });

  it("registers or folds every contracts/lib/*.sol", () => {
    const onDisk = listLibContractSolFiles();
    const registered = LIB_ERROR_COVERAGE_REGISTRY.map((e) => e.contract).sort();
    const folded = [...LIB_ERROR_FOLDED].sort();
    const covered = [...registered, ...folded].sort();
    assert.deepEqual(
      covered,
      onDisk,
      `LIB registry ∪ FOLDED must equal contracts/lib/*.sol. onDisk=${onDisk.join(",")} covered=${covered.join(",")}`,
    );
    for (const name of folded) {
      assert.ok(
        !registered.includes(name),
        `folded lib ${name} must not also be in LIB_ERROR_COVERAGE_REGISTRY`,
      );
    }
    for (const entry of LIB_ERROR_COVERAGE_REGISTRY) {
      const abs = path.join(CONTRACTS_DIR, entry.errorSource);
      assert.ok(fs.existsSync(abs), `missing lib error source: ${entry.errorSource}`);
    }
  });

  it("untriggerable and pending_removal are disjoint and cite declared errors", () => {
    const declared = new Map<string, Set<string>>();
    for (const entry of ALL_ERROR_COVERAGE_REGISTRY) {
      const source = fs.readFileSync(path.join(CONTRACTS_DIR, entry.errorSource), "utf8");
      declared.set(entry.contract, new Set(parseErrorNames(source)));
    }
    assertEscapeEntriesValid("untriggerable", ERROR_COVERAGE_UNTRIGGERABLE, declared);
    assertEscapeEntriesValid("pending_removal", ERROR_COVERAGE_PENDING_REMOVAL, declared);

    const unKeys = new Set(
      ERROR_COVERAGE_UNTRIGGERABLE.map((e) => escapeKey(e.contract, e.error)),
    );
    for (const row of ERROR_COVERAGE_PENDING_REMOVAL) {
      const key = escapeKey(row.contract, row.error);
      assert.ok(
        !unKeys.has(key),
        `escape hatch overlap: ${key} is in both untriggerable and pending_removal`,
      );
    }
  });

  it("every declared (contract, error) is covered, untriggerable, or pending_removal", () => {
    const { missing, matrixText, untriggerableText, pendingRemovalText } =
      buildErrorCoverageReport();
    assert.equal(
      missing.length,
      0,
      `Missing error coverage (per-contract revertsWith):\n${missing
        .map((m) => `  ${m.contract}.${m.error}`)
        .join("\n")}\n\n${untriggerableText}\n\n${pendingRemovalText}\n\nFull matrix:\n${matrixText}`,
    );
  });

  it("parses KargainError variant names from the sole Rust owner", () => {
    const fixture = `
      pub enum KargainError {
          #[error("Foo")]
          Foo = 0,
          #[error("Bar")]
          Bar = 1,
      }
    `;
    assert.deepEqual(parseKargainErrorEnumNames(fixture), ["Bar", "Foo"]);
    const live = loadKargainErrorEnumNames();
    assert.ok(live.includes("NoClaim"));
    assert.ok(live.includes("WrongValue"));
    for (const name of SVM_ONLY_ERROR_NAMES) {
      assert.ok(live.includes(name), `SVM-only ${name} missing from KargainError`);
    }
  });

  it("forbids a second KargainError enum under svm/", () => {
    const ownerRel = path.relative(ROOT, SVM_KARGAIN_ERRORS_RS);
    const svmRoot = path.join(ROOT, "svm");
    const offenders: string[] = [];
    for (const file of listRustSourcesUnder(svmRoot)) {
      const text = fs.readFileSync(file, "utf8");
      KARGAIN_ERROR_ENUM_RE.lastIndex = 0;
      if (!KARGAIN_ERROR_ENUM_RE.test(text)) continue;
      const rel = path.relative(ROOT, file);
      if (rel !== ownerRel) offenders.push(rel);
    }
    assert.deepEqual(
      offenders,
      [],
      `KargainError enum must live only in ${ownerRel}; also found:\n${offenders.join("\n")}`,
    );
  });

  it("Rust KargainError names mirror Solidity except SVM-only allowlist", () => {
    const rust = new Set(loadKargainErrorEnumNames());
    const solidity = collectAllSolidityCustomErrorNames();
    const svmOnly = new Set<string>(SVM_ONLY_ERROR_NAMES);

    for (const name of svmOnly) {
      assert.ok(rust.has(name), `SVM-only allowlist entry missing from Rust: ${name}`);
      assert.ok(
        !solidity.has(name),
        `SVM-only ${name} must not be declared as a Solidity custom error`,
      );
    }

    const missingInSolidity = [...rust]
      .filter((n) => !svmOnly.has(n) && !solidity.has(n))
      .sort();
    assert.deepEqual(
      missingInSolidity,
      [],
      `Rust KargainError names without Solidity custom error (add to Solidity or SVM_ONLY_ERROR_NAMES):\n${missingInSolidity.join("\n")}`,
    );
  });

  it("required SVM unit-test error paths are exercised (revertsWith analog)", () => {
    const exercised = new Set<string>();
    for (const rel of SVM_ERROR_ASSERT_OWNERS) {
      const abs = path.join(ROOT, rel);
      assert.ok(fs.existsSync(abs), `missing SVM assert owner: ${rel}`);
      for (const n of collectRustTestModuleErrorAsserts(fs.readFileSync(abs, "utf8"))) {
        exercised.add(n);
      }
    }
    const missing = SVM_ERROR_UNIT_COVERAGE_REQUIRED.filter((n) => !exercised.has(n));
    assert.deepEqual(
      missing,
      [],
      `Missing SVM unit asserts for ${missing.join(", ")} — add Err(KargainError::…) / CodecError::… inside #[cfg(test)] under SVM_ERROR_ASSERT_OWNERS`,
    );
  });
});
