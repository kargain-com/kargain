/**
 * Error name-truth policy — one error name, one predicate family (polarity /
 * multi-condition families / NotX underassertion).
 *
 * Money-path outcome testing: see header of `error-coverage-policy.test.ts`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectAllSolidityCustomErrorNames,
  loadKargainErrorEnumNames,
  parseKargainErrorEnumNames,
  SVM_ONLY_ERROR_NAMES,
} from "./error-coverage-policy.test.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS_DIR = path.join(ROOT, "contracts");
const SVM_KARGAIN_ERRORS_RS = path.join(
  ROOT,
  "svm/crates/kargain-errors/src/lib.rs",
);

/**
 * One truthful English family that legitimately covers ≥2 distinct normalized
 * predicates. Keep small — growth means the naming rule is being bent.
 */
export const ERROR_MULTI_CONDITION_FAMILIES: readonly {
  error: string;
  contracts: readonly string[];
  justification: string;
}[] = [
  {
    error: "BidTooLow",
    contracts: ["AscendingConsignment"],
    justification: "Amount below first-bid reserve or below min next bid",
  },
  {
    error: "BadConfig",
    contracts: ["AscendingConsignment", "AscendingOpenLib"],
    justification: "Config value out of allowed bounds or zero where forbidden",
  },
  {
    error: "NothingToRescue",
    contracts: ["KarPassport"],
    justification: "Rescue amount zero or exceeds free balance",
  },
  {
    error: "BadOracleAnswer",
    contracts: ["FixedPriceConsignment"],
    justification: "Oracle answer or derived rate non-positive",
  },
  {
    error: "EmptyField",
    contracts: ["KarPassport"],
    justification: "Empty required string field (address zeros use ZeroAddress)",
  },
  {
    error: "BelowMinStake",
    contracts: ["KarProStaking"],
    justification: "Native or ERC-20 join below configured minimum",
  },
  {
    error: "TokenNonConforming",
    contracts: ["Erc20Admission"],
    justification: "Admission probe call fails or returndata is non-conforming",
  },
  {
    error: "WrongValue",
    contracts: ["FixedPriceConsignment"],
    justification: "msg.value does not match the required native amount (or must be zero)",
  },
  {
    error: "InvalidStatus",
    contracts: ["KarPassport"],
    justification: "Action not allowed for the passport's current Status",
  },
  {
    error: "CannotResolveOwnDispute",
    contracts: ["KarPassport"],
    justification:
      "Caller is a party to the dispute (opener, passport owner, or recorded passportVerifier) — mirrors CannotResolveOwnDeal",
  },
  // Newly visible after paren-depth extraction (same English families; were silent drops).
  {
    error: "ZeroAddress",
    contracts: [
      "FixedPriceConsignment",
      "KarPassport",
      "KarPassportBridgeGateway",
      "ConsignmentBase",
    ],
    justification: "Required address argument is the zero address",
  },
  {
    error: "TransferFailed",
    contracts: ["ClaimablePayouts"],
    justification: "Native send failed or ERC-20 transfer probe returned false",
  },
  {
    error: "NotBinding",
    contracts: ["AscendingConsignment", "AscendingHoldLib"],
    justification: "Settle refused — phase not binding or auction endsAt unset",
  },
  {
    error: "DisputeActive",
    contracts: ["AscendingHoldLib"],
    justification: "Hold exit refused while settlement challenge open or freeze already set",
  },
] as const;

/**
 * Same logical predicate spelled differently so the normaliser cannot unify them.
 * Never use this list to excuse a real underassertion or polarity clash.
 */
export const ERROR_NORMALISER_ALIASES: readonly {
  error: string;
  contracts: readonly string[];
  justification: string;
}[] = [
  {
    error: "NotVerifier",
    contracts: ["KarProStaking"],
    justification: "Caller stake row inactive — !s.active vs !stakes[msg.sender].active",
  },
] as const;

/** @deprecated Prefer ERROR_MULTI_CONDITION_FAMILIES; kept for any external imports. */
export const ERROR_MULTI_CONDITION_ALLOWLIST = ERROR_MULTI_CONDITION_FAMILIES;

type Site = { file: string; error: string; raw: string; normalized: string };

type RawIfRevert = { condition: string; error: string; index: number };

function listSoliditySources(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "test" || entry.name === "mocks") continue;
        walk(full);
      } else if (entry.name.endsWith(".sol")) {
        out.push(full);
      }
    }
  }
  walk(CONTRACTS_DIR);
  return out.sort();
}

/**
 * Extract balanced `(...)` starting at `openParenIndex` (must point at `(`).
 * Returns inner content and end index after the closing `)`.
 */
export function extractBalancedParens(
  source: string,
  openParenIndex: number,
): { inner: string; end: number } | null {
  if (source[openParenIndex] !== "(") return null;
  let depth = 0;
  for (let i = openParenIndex; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return { inner: source.slice(openParenIndex + 1, i), end: i + 1 };
      }
    }
  }
  return null;
}

/**
 * Same-line `if (<cond>) revert <Name>(...);` with paren-depth condition parse.
 * Multi-line conditions are out of scope (by design).
 */
export function extractSameLineIfReverts(source: string): RawIfRevert[] {
  const out: RawIfRevert[] = [];
  const ifRe = /\bif\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = ifRe.exec(source)) !== null) {
    const openIdx = m.index + m[0]!.length - 1;
    const bal = extractBalancedParens(source, openIdx);
    if (!bal) continue;
    // Remainder of the physical line after the condition's closing `)`.
    const after = source.slice(bal.end);
    const lineEnd = after.search(/[\r\n]/);
    const restOfLine = lineEnd === -1 ? after : after.slice(0, lineEnd);
    const rev = restOfLine.match(/^\s*revert\s+([A-Za-z0-9_]+)\s*(?:\(|;)/);
    if (!rev) continue;
    out.push({
      condition: bal.inner.trim(),
      error: rev[1]!,
      index: m.index,
    });
  }
  return out;
}

/**
 * Normalize a Solidity boolean condition to a polarity-comparable key.
 * Returns empty string when the condition is too complex for this checker.
 */
export function normalizePredicate(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  while (s.startsWith("(") && s.endsWith(")")) {
    const inner = s.slice(1, -1).trim();
    // Only strip if outer parens are balanced matching pair
    if (extractBalancedParens(`(${inner})`, 0)?.inner === inner) {
      s = inner;
    } else {
      break;
    }
  }

  s = s.replace(/address\s*\(\s*0\s*\)/g, "0");
  s = s.replace(/bytes32\s*\(\s*0\s*\)/g, "0");

  if (s.includes("||") || s.includes("&&")) {
    const parts = s.split(/\s*(\|\||&&)\s*/);
    const norms = parts
      .filter((_, i) => i % 2 === 0)
      .map((p) => normalizeSimple(p.trim()))
      .filter(Boolean)
      .sort();
    const ops = parts.filter((_, i) => i % 2 === 1);
    if (norms.length === 0) return "";
    return norms.join(` ${ops[0] ?? "||"} `);
  }

  return normalizeSimple(s);
}

function normalizeSimple(s: string): string {
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/address\s*\(\s*0\s*\)/g, "0");
  s = s.replace(/bytes32\s*\(\s*0\s*\)/g, "0");

  if (s.startsWith("!")) {
    const inner = s.slice(1).trim();
    return `!${inner}`;
  }

  const cmp = s.match(/^(.+?)\s*(==|!=|>|>=|<|<=)\s*(.+)$/);
  if (!cmp) {
    return s;
  }
  let lhs = cmp[1]!.trim();
  let op = cmp[2]!;
  let rhs = cmp[3]!.trim();

  if (/^(0|true|false|\d+)$/.test(lhs) && !/^(0|true|false|\d+)$/.test(rhs)) {
    const flip: Record<string, string> = {
      "==": "==",
      "!=": "!=",
      ">": "<",
      ">=": "<=",
      "<": ">",
      "<=": ">=",
    };
    [lhs, rhs] = [rhs, lhs];
    op = flip[op] ?? op;
  }

  if (op === "==" || op === "!=") {
    if (lhs.localeCompare(rhs) > 0) {
      [lhs, rhs] = [rhs, lhs];
    }
  }

  return `${lhs} ${op} ${rhs}`;
}

/** Opposite polarity of a normalized simple comparison, or null if unknown. */
export function oppositePredicate(normalized: string): string | null {
  if (normalized.includes("||") || normalized.includes("&&")) return null;

  if (normalized.startsWith("!")) {
    return normalized.slice(1);
  }

  const cmp = normalized.match(/^(.+?) ([=!<>]=?) (.+)$/);
  if (!cmp) {
    return `!${normalized}`;
  }
  const lhs = cmp[1]!;
  const op = cmp[2]!;
  const rhs = cmp[3]!;
  const flip: Record<string, string> = {
    "==": "!=",
    "!=": "==",
    ">": "<=",
    ">=": "<",
    "<": ">=",
    "<=": ">",
  };
  const flipped = flip[op];
  if (!flipped) return null;
  return `${lhs} ${flipped} ${rhs}`;
}

export function collectRevertSites(source: string, fileLabel: string): Site[] {
  const sites: Site[] = [];
  for (const raw of extractSameLineIfReverts(source)) {
    const normalized = normalizePredicate(raw.condition);
    if (!normalized) continue;
    sites.push({
      file: fileLabel,
      error: raw.error,
      raw: raw.condition,
      normalized,
    });
  }
  return sites;
}

/**
 * Roles named by a `NotX` / `NotXOrY` error (lowercased stems).
 * Returns null if the name is not a Not* role form.
 */
export function rolesFromNotErrorName(error: string): string[] | null {
  if (!error.startsWith("Not") || error.length <= 3) return null;
  // Skip Not* that are not role gates (NotOffered, NotBinding, NotActive, …)
  // Underassertion rule only applies when the condition is msg.sender role compounds.
  const body = error.slice(3);
  return body
    .split("Or")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Extract role stems from `msg.sender != <role>` / `msg.sender != <role>()` conjuncts.
 * Returns null if the condition is not a pure && of such conjuncts (≥2).
 */
export function senderRoleStemsFromCondition(raw: string): string[] | null {
  let s = raw.replace(/\s+/g, " ").trim();
  while (s.startsWith("(") && s.endsWith(")")) {
    const inner = s.slice(1, -1).trim();
    if (extractBalancedParens(`(${inner})`, 0)?.inner === inner) s = inner;
    else break;
  }
  if (!s.includes("&&") || s.includes("||")) return null;
  const parts = s.split(/\s*&&\s*/).map((p) => p.trim());
  if (parts.length < 2) return null;
  const stems: string[] = [];
  for (const part of parts) {
    const m = part.match(
      /^msg\.sender\s*!=\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*\))?\s*$/,
    );
    if (!m) return null;
    stems.push(m[1]!.toLowerCase());
  }
  return stems.sort();
}

/**
 * `NotGuardian` understates `msg.sender != guardian && msg.sender != owner()` —
 * the name asserts a subset of the roles the condition actually admits.
 */
export function findNotRoleUnderassertions(sites: Site[]): string[] {
  const violations: string[] = [];
  for (const site of sites) {
    const named = rolesFromNotErrorName(site.error);
    if (!named) continue;
    const stems = senderRoleStemsFromCondition(site.raw);
    if (!stems || stems.length < 2) continue;
    // Map owner() → owner already via stem capture.
    const namedSet = new Set(named);
    const missing = stems.filter((s) => !namedSet.has(s));
    if (missing.length > 0) {
      violations.push(
        `${site.file} ${site.error}: condition admits roles [${stems.join(", ")}] but name only claims [${named.join(", ")}] — missing [${missing.join(", ")}]`,
      );
    }
  }
  return violations;
}

function allowlistKey(contract: string, error: string): string {
  return `${contract}::${error}`;
}

function buildFamilyAllowlistSet(): Set<string> {
  const set = new Set<string>();
  for (const entry of ERROR_MULTI_CONDITION_FAMILIES) {
    for (const c of entry.contracts) {
      set.add(allowlistKey(c, entry.error));
    }
  }
  return set;
}

function buildNormaliserAliasSet(): Set<string> {
  const set = new Set<string>();
  for (const entry of ERROR_NORMALISER_ALIASES) {
    for (const c of entry.contracts) {
      set.add(allowlistKey(c, entry.error));
    }
  }
  return set;
}

export function findPolarityViolations(sites: Site[]): string[] {
  const byError = new Map<string, Site[]>();
  for (const site of sites) {
    const list = byError.get(site.error) ?? [];
    list.push(site);
    byError.set(site.error, list);
  }
  const violations: string[] = [];
  for (const [error, list] of byError) {
    const norms = [...new Set(list.map((s) => s.normalized))];
    for (const n of norms) {
      const opp = oppositePredicate(n);
      if (opp && norms.includes(opp)) {
        violations.push(
          `${error}: contradictory predicates "${n}" and "${opp}" in ${[...new Set(list.map((s) => s.file))].join(", ")}`,
        );
      }
    }
  }
  return violations;
}

export function findUnjustifiedMultiCondition(
  sites: Site[],
  families: Set<string>,
  aliases: Set<string>,
): string[] {
  const byContractError = new Map<string, Set<string>>();
  for (const site of sites) {
    const contract = path.basename(site.file, ".sol");
    const key = allowlistKey(contract, site.error);
    const set = byContractError.get(key) ?? new Set();
    set.add(site.normalized);
    byContractError.set(key, set);
  }
  const violations: string[] = [];
  for (const [key, norms] of byContractError) {
    if (norms.size < 2) continue;
    if (families.has(key)) continue;
    if (aliases.has(key)) continue; // still counted separately; not a "family" miss
    violations.push(
      `${key}: ${norms.size} distinct predicates without family/alias entry — ${[...norms].join(" | ")}`,
    );
  }
  return violations;
}

/** Alias entries that still have ≥2 distinct norms after extraction (still needed). */
export function findStillNeededAliases(
  sites: Site[],
  aliases: Set<string>,
): { needed: string[]; obsolete: string[] } {
  const byContractError = new Map<string, Set<string>>();
  for (const site of sites) {
    const contract = path.basename(site.file, ".sol");
    const key = allowlistKey(contract, site.error);
    const set = byContractError.get(key) ?? new Set();
    set.add(site.normalized);
    byContractError.set(key, set);
  }
  const needed: string[] = [];
  const obsolete: string[] = [];
  for (const key of aliases) {
    const norms = byContractError.get(key);
    if (norms && norms.size >= 2) needed.push(key);
    else obsolete.push(key);
  }
  return { needed, obsolete };
}

describe("error-name-truth-policy", () => {
  it("paren-depth extractor captures owner() inside revoke-style gates", () => {
    const fixture = `
      contract Demo {
        function revoke() external {
          if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        }
      }
    `;
    const raw = extractSameLineIfReverts(fixture);
    assert.equal(raw.length, 1);
    assert.match(raw[0]!.condition, /owner\(\)/);
    const sites = collectRevertSites(fixture, "Demo.sol");
    assert.equal(sites.length, 1);
  });

  it("detects NotX underassertion when name omits a role the condition admits", () => {
    const fixture = `
      contract Demo {
        function revoke() external {
          if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        }
      }
    `;
    const sites = collectRevertSites(fixture, "Demo.sol");
    const hits = findNotRoleUnderassertions(sites);
    assert.ok(hits.length >= 1);
    assert.match(hits[0]!, /NotGuardian/);
    assert.match(hits[0]!, /owner/);
  });

  it("NotGuardianOrOwner matches guardian+owner compound", () => {
    const fixture = `
      contract Demo {
        function revoke() external {
          if (msg.sender != guardian && msg.sender != owner()) revert NotGuardianOrOwner();
        }
      }
    `;
    const sites = collectRevertSites(fixture, "Demo.sol");
    assert.deepEqual(findNotRoleUnderassertions(sites), []);
  });

  it("detects a name guarding a condition and its negation (fixture)", () => {
    const fixture = `
      contract Demo {
        function a(uint256 x) external pure {
          if (x == 0) revert BadName();
          if (x != 0) revert BadName();
        }
      }
    `;
    const sites = collectRevertSites(fixture, "Demo.sol");
    const violations = findPolarityViolations(sites);
    assert.ok(violations.length >= 1, "expected polarity violation");
    assert.match(violations[0]!, /BadName/);
  });

  it("RefundPending / RefundNotPending opposite polarity with distinct names is fine", () => {
    const fixture = `
      contract Demo {
        function a(uint256 refundPendingAt) external pure {
          if (refundPendingAt > 0) revert RefundPending();
          if (refundPendingAt == 0) revert RefundNotPending();
        }
      }
    `;
    const sites = collectRevertSites(fixture, "Demo.sol");
    assert.equal(findPolarityViolations(sites).length, 0);
  });

  it("every same-line if-revert is collected (no nested-paren silent drops)", () => {
    for (const file of listSoliditySources()) {
      const source = fs.readFileSync(file, "utf8");
      const extracted = extractSameLineIfReverts(source);
      // Re-scan with a line-oriented check: each physical line containing both
      // `if (` and `revert Name` must appear in extracted.
      const lines = source.split(/\r?\n/);
      let expected = 0;
      for (const line of lines) {
        if (/\bif\s*\(/.test(line) && /\brevert\s+[A-Za-z0-9_]+/.test(line)) {
          expected++;
        }
      }
      assert.equal(
        extracted.length,
        expected,
        `${path.relative(CONTRACTS_DIR, file)}: extracted ${extracted.length} same-line if-reverts, line scan expected ${expected}`,
      );
    }
  });

  it("production contracts have no polarity contradictions", () => {
    const sites: Site[] = [];
    for (const file of listSoliditySources()) {
      const rel = path.relative(CONTRACTS_DIR, file);
      sites.push(...collectRevertSites(fs.readFileSync(file, "utf8"), rel));
    }
    const violations = findPolarityViolations(sites);
    assert.deepEqual(violations, [], violations.join("\n"));
  });

  it("NotX role underassertion is empty on production sources", () => {
    const sites: Site[] = [];
    for (const file of listSoliditySources()) {
      const rel = path.relative(CONTRACTS_DIR, file);
      sites.push(...collectRevertSites(fs.readFileSync(file, "utf8"), rel));
    }
    const violations = findNotRoleUnderassertions(sites);
    assert.deepEqual(
      violations,
      [],
      `NotX underassertion (rename to match roles, do not allowlist):\n${violations.join("\n")}`,
    );
  });

  it("multi-condition names are family- or alias-listed with justifications", () => {
    const sites: Site[] = [];
    for (const file of listSoliditySources()) {
      const rel = path.relative(CONTRACTS_DIR, file);
      sites.push(...collectRevertSites(fs.readFileSync(file, "utf8"), rel));
    }
    const families = buildFamilyAllowlistSet();
    const aliases = buildNormaliserAliasSet();
    const violations = findUnjustifiedMultiCondition(sites, families, aliases);
    assert.deepEqual(
      violations,
      [],
      `Unjustified multi-condition errors (split name or add to families — never aliases for real families):\n${violations.join("\n")}`,
    );
  });

  it("allowlist split: families vs normaliser aliases stay small and justified", () => {
    assert.ok(
      ERROR_MULTI_CONDITION_FAMILIES.length <= 16,
      `families grew to ${ERROR_MULTI_CONDITION_FAMILIES.length}; prefer splits`,
    );
    assert.ok(
      ERROR_NORMALISER_ALIASES.length <= 8,
      `aliases grew to ${ERROR_NORMALISER_ALIASES.length}; prefer normaliser fix`,
    );
    for (const entry of ERROR_MULTI_CONDITION_FAMILIES) {
      assert.ok(entry.justification.trim().length > 10, entry.error);
    }
    for (const entry of ERROR_NORMALISER_ALIASES) {
      assert.ok(entry.justification.trim().length > 10, entry.error);
    }
    // No overlap between lists
    const famKeys = new Set(
      ERROR_MULTI_CONDITION_FAMILIES.flatMap((e) =>
        e.contracts.map((c) => allowlistKey(c, e.error)),
      ),
    );
    for (const entry of ERROR_NORMALISER_ALIASES) {
      for (const c of entry.contracts) {
        assert.ok(
          !famKeys.has(allowlistKey(c, entry.error)),
          `${entry.error} must not appear in both families and aliases`,
        );
      }
    }
  });

  it("normaliser aliases are still needed after extraction (or empty obsolete list)", () => {
    const sites: Site[] = [];
    for (const file of listSoliditySources()) {
      const rel = path.relative(CONTRACTS_DIR, file);
      sites.push(...collectRevertSites(fs.readFileSync(file, "utf8"), rel));
    }
    const { needed, obsolete } = findStillNeededAliases(
      sites,
      buildNormaliserAliasSet(),
    );
    assert.deepEqual(
      obsolete,
      [],
      `Obsolete normaliser aliases (remove from ERROR_NORMALISER_ALIASES): ${obsolete.join(", ")}`,
    );
    assert.ok(needed.length === ERROR_NORMALISER_ALIASES.length);
  });

  it("thiserror Display strings match KargainError variant names", () => {
    const source = fs.readFileSync(SVM_KARGAIN_ERRORS_RS, "utf8");
    const pairs: { display: string; variant: string }[] = [];
    const pairRe =
      /#\[error\("([A-Za-z0-9_]+)"\)\]\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\d+/g;
    let match: RegExpExecArray | null;
    while ((match = pairRe.exec(source)) !== null) {
      pairs.push({ display: match[1]!, variant: match[2]! });
    }
    const variants = parseKargainErrorEnumNames(source);
    assert.equal(
      pairs.length,
      variants.length,
      `expected one #[error("…")] per variant; got ${pairs.length} attrs for ${variants.length} variants`,
    );
    const mismatches = pairs.filter((p) => p.display !== p.variant);
    assert.deepEqual(
      mismatches,
      [],
      `Display≠variant (indexer/UI contract):\n${mismatches
        .map((p) => `  ${p.variant} vs "${p.display}"`)
        .join("\n")}`,
    );
  });

  it("bidirectional: Rust KargainError ↔ Solidity custom errors (SVM-only allowlist)", () => {
    const rust = loadKargainErrorEnumNames();
    const solidity = collectAllSolidityCustomErrorNames();
    const svmOnly = new Set<string>(SVM_ONLY_ERROR_NAMES);

    // Rust → Solidity (except D-16 SVM-only).
    const rustMissingSolidity = rust.filter((n) => !svmOnly.has(n) && !solidity.has(n));
    assert.deepEqual(
      rustMissingSolidity,
      [],
      `Rust names without Solidity declaration:\n${rustMissingSolidity.join("\n")}`,
    );

    // Solidity → Rust for names that claim to be in the shared enum:
    // every non-SVM-only Rust name must be a Solidity custom error (above), and
    // every SVM-only name must be Rust-only (below). Inverse: Solidity must not
    // declare SVM-only names; Solidity names absent from Rust are EVM-only (ok).
    for (const name of svmOnly) {
      assert.ok(rust.includes(name), `SVM-only ${name} missing from KargainError`);
      assert.ok(!solidity.has(name), `SVM-only ${name} must stay out of Solidity`);
    }

    // Allowlist stays exact — no silent growth without D-16 justification.
    assert.deepEqual(
      [...SVM_ONLY_ERROR_NAMES].sort(),
      [
        "ArithmeticOverflow",
        "ComposeRequired",
        "ComposeUndecodable",
        "ConfidenceTooWide",
        "FiatDenominationRefused",
        "MissingAgentRecipient",
        "MissingPlatformRecipient",
        "MissingSellerRecipient",
        "TransferFeeExtensionForbidden",
        "WrongAgentRecipient",
        "WrongPlatformRecipient",
        "WrongSellerRecipient",
      ],
    );
  });
});
