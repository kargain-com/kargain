import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS_DIR = path.join(ROOT, "contracts");

export type ErrorCoverageEntry = {
  contract: string;
  errorSource: string;
  suiteFiles: string[];
};

/** Production contracts → error declaration source + suites that count for coverage. */
export const ERROR_COVERAGE_REGISTRY: readonly ErrorCoverageEntry[] = [
  {
    contract: "AuctionEscrow",
    errorSource: "interfaces/IAuctionEscrow.sol",
    suiteFiles: ["AuctionEscrowV1.test.ts"],
  },
  {
    contract: "MarketplaceEscrow",
    errorSource: "MarketplaceEscrow.sol",
    suiteFiles: ["MarketplaceEscrowV2.test.ts"],
  },
  {
    contract: "KarPassport",
    errorSource: "KarPassport.sol",
    suiteFiles: [
      "KarPassportV2.test.ts",
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
] as const;

/**
 * Abstract lib primitives under contracts/lib/ that own custom errors.
 * Not listed by the root contracts/*.sol production scanner.
 */
export const LIB_ERROR_COVERAGE_REGISTRY: readonly ErrorCoverageEntry[] = [
  {
    contract: "BondedChallenge",
    errorSource: "lib/BondedChallenge.sol",
    suiteFiles: ["bonded-challenge/BondedChallenge.test.ts"],
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

export type PairStatus = "covered" | "untriggerable" | "pending_removal" | "missing";

export type CoveragePair = {
  contract: string;
  error: string;
  status: PairStatus;
};

function listProductionContractSolFiles(): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(CONTRACTS_DIR, { withFileTypes: true })) {
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

    // ClaimablePayouts errors are inherited by the four money-moving contracts.
    // Erc20Admission errors apply only where tokens enter (not KarPassport).
    if (
      entry.contract === "AuctionEscrow" ||
      entry.contract === "MarketplaceEscrow" ||
      entry.contract === "KarPassport" ||
      entry.contract === "KarProStaking"
    ) {
      const claimSource = fs.readFileSync(
        path.join(CONTRACTS_DIR, "lib/ClaimablePayouts.sol"),
        "utf8",
      );
      errors = [...new Set([...errors, ...parseErrorNames(claimSource)])].sort();
    }
    if (
      entry.contract === "AuctionEscrow" ||
      entry.contract === "MarketplaceEscrow" ||
      entry.contract === "KarProStaking"
    ) {
      const admissionSource = fs.readFileSync(
        path.join(CONTRACTS_DIR, "lib/Erc20Admission.sol"),
        "utf8",
      );
      // TokenDecimalsUnavailable is only reachable via MarketplaceEscrow.approvePaymentToken.
      const admissionErrors = parseErrorNames(admissionSource).filter(
        (name) =>
          name !== "TokenDecimalsUnavailable" || entry.contract === "MarketplaceEscrow",
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

  it("registers abstract lib primitives under contracts/lib/", () => {
    const registered = LIB_ERROR_COVERAGE_REGISTRY.map((e) => e.contract).sort();
    assert.deepEqual(registered, ["BondedChallenge", "Mandate", "Recall"]);
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
});
