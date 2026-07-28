import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS_DIR = path.join(ROOT, "contracts");

/**
 * Names that legitimately guard ≥2 distinct normalized predicates under one truthful
 * English predicate. Keep small — growth means the naming rule is being bent.
 */
export const ERROR_MULTI_CONDITION_ALLOWLIST: readonly {
  error: string;
  contracts: readonly string[];
  justification: string;
}[] = [
  {
    error: "AgentNotAuthorized",
    contracts: ["AuctionEscrow", "MarketplaceEscrow"],
    justification:
      "Caller is not an in-window authorized agent (!active / wrong agent / expired); zero-agent is ZeroAddress",
  },
  {
    error: "HoldActive",
    contracts: ["AuctionEscrow"],
    justification: "A settlement or abandoned-refund clock has not elapsed",
  },
  {
    error: "DisputeActive",
    contracts: ["AuctionEscrow"],
    justification: "Dispute already open or resolution window still open",
  },
  {
    error: "BidTooLow",
    contracts: ["AuctionEscrow"],
    justification: "Amount below first-bid reserve or below min next bid",
  },
  {
    error: "BadConfig",
    contracts: ["AuctionEscrow"],
    justification: "Config value out of allowed bounds or zero where forbidden",
  },
  {
    error: "NothingToRescue",
    contracts: ["KarPassport"],
    justification: "Rescue amount zero or exceeds free balance",
  },
  {
    error: "BadOracleAnswer",
    contracts: ["MarketplaceEscrow"],
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
    error: "BadPrice",
    contracts: ["MarketplaceEscrow"],
    justification: "Zero listing / update price (any zero-price variable)",
  },
  {
    error: "WrongValue",
    contracts: ["AuctionEscrow", "MarketplaceEscrow"],
    justification: "msg.value does not match the required native amount (or must be zero)",
  },
  {
    error: "InvalidStatus",
    contracts: ["KarPassport"],
    justification: "Action not allowed for the passport's current Status",
  },
  {
    error: "NotVerifier",
    contracts: ["KarProStaking"],
    justification: "Caller stake row is inactive",
  },
  {
    error: "AgentFeeTooHigh",
    contracts: ["MarketplaceEscrow", "AuctionEscrow"],
    justification: "Agent fee bps above protocol max",
  },
] as const;

/** `if (<cond>) revert <Name>(...);` — ignores multi-line conditions. */
const IF_REVERT_RE =
  /if\s*\(([^)]+)\)\s*revert\s+([A-Za-z0-9_]+)\s*(?:\(|;)/g;

type Site = { file: string; error: string; raw: string; normalized: string };

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
 * Normalize a Solidity boolean condition to a polarity-comparable key.
 * Returns empty string when the condition is too complex for this checker.
 */
export function normalizePredicate(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  // Strip outer parens
  while (s.startsWith("(") && s.endsWith(")")) {
    s = s.slice(1, -1).trim();
  }

  // Collapse address(0) / bytes32(0)
  s = s.replace(/address\s*\(\s*0\s*\)/g, "0");
  s = s.replace(/bytes32\s*\(\s*0\s*\)/g, "0");

  // Negation forms → positive with bang prefix on comparison
  // Keep compound with || / && as opaque multi-keys (sorted parts)
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

  // bang-prefix
  if (s.startsWith("!")) {
    const inner = s.slice(1).trim();
    // !x.active → treat as field truth polarity
    return `!${inner}`;
  }

  const cmp = s.match(/^(.+?)\s*(==|!=|>|>=|<|<=)\s*(.+)$/);
  if (!cmp) {
    // bare truthy (e.g. paused, listings[tokenId].active)
    return s;
  }
  let lhs = cmp[1]!.trim();
  let op = cmp[2]!;
  let rhs = cmp[3]!.trim();

  // Flip so constant is on the right when possible
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

  // Commutative == / != : sort operands so `a != b` and `b != a` collapse
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
    // bare → bang
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
  IF_REVERT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IF_REVERT_RE.exec(source)) !== null) {
    const raw = match[1]!.trim();
    const error = match[2]!;
    const normalized = normalizePredicate(raw);
    if (!normalized) continue;
    sites.push({ file: fileLabel, error, raw, normalized });
  }
  return sites;
}

function contractLabelFromPath(filePath: string): string {
  return path.basename(filePath, ".sol");
}

function allowlistKey(contract: string, error: string): string {
  return `${contract}::${error}`;
}

function buildAllowlistSet(): Set<string> {
  const set = new Set<string>();
  for (const entry of ERROR_MULTI_CONDITION_ALLOWLIST) {
    for (const c of entry.contracts) {
      set.add(allowlistKey(c, entry.error));
    }
  }
  return set;
}

export function findPolarityViolations(sites: Site[]): string[] {
  const byError = new Map<string, Site[]>();
  for (const site of sites) {
    const key = site.error;
    const list = byError.get(key) ?? [];
    list.push(site);
    byError.set(key, list);
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
  allowlist: Set<string>,
): string[] {
  const byContractError = new Map<string, Set<string>>();
  for (const site of sites) {
    const contract = path.basename(site.file, ".sol");
    // Interfaces: map IAuctionEscrow → AuctionEscrow for allowlist
    const mapped =
      contract === "IAuctionEscrow"
        ? "AuctionEscrow"
        : contract === "IMarketplaceEscrow"
          ? "MarketplaceEscrow"
          : contract;
    const key = allowlistKey(mapped, site.error);
    const set = byContractError.get(key) ?? new Set();
    set.add(site.normalized);
    byContractError.set(key, set);
  }
  const violations: string[] = [];
  for (const [key, norms] of byContractError) {
    if (norms.size < 2) continue;
    if (allowlist.has(key)) continue;
    violations.push(
      `${key}: ${norms.size} distinct predicates without allowlist entry — ${[...norms].join(" | ")}`,
    );
  }
  return violations;
}

describe("error-name-truth-policy", () => {
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

  it("production contracts have no polarity contradictions", () => {
    const sites: Site[] = [];
    for (const file of listSoliditySources()) {
      const rel = path.relative(CONTRACTS_DIR, file);
      sites.push(...collectRevertSites(fs.readFileSync(file, "utf8"), rel));
    }
    const violations = findPolarityViolations(sites);
    assert.deepEqual(violations, [], violations.join("\n"));
  });

  it("multi-condition names are allowlisted with justifications", () => {
    const sites: Site[] = [];
    for (const file of listSoliditySources()) {
      const rel = path.relative(CONTRACTS_DIR, file);
      sites.push(...collectRevertSites(fs.readFileSync(file, "utf8"), rel));
    }
    // Attribute interface revert sites to implementing contract files by also
    // scanning AuctionEscrow for IAuctionEscrow errors (sites live in .sol bodies).
    const allowlist = buildAllowlistSet();
    const violations = findUnjustifiedMultiCondition(sites, allowlist);
    assert.deepEqual(
      violations,
      [],
      `Unjustified multi-condition errors (add split or allowlist):\n${violations.join("\n")}`,
    );
  });

  it("allowlist stays small", () => {
    assert.ok(
      ERROR_MULTI_CONDITION_ALLOWLIST.length <= 16,
      `allowlist grew to ${ERROR_MULTI_CONDITION_ALLOWLIST.length}; prefer splits`,
    );
    for (const entry of ERROR_MULTI_CONDITION_ALLOWLIST) {
      assert.ok(entry.justification.trim().length > 10, entry.error);
    }
  });
});
