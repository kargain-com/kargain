/**
 * §7.2 U1 — which product files contain a write site.
 *
 * Owns exactly that file set. Does not restate useTxSync coupling,
 * passport-approval location, or evm-write-adapter ownership.
 *
 * Human action matrix lives in the local research annex (gitignored);
 * this suite must never read or import it.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PRODUCT_ROOTS = ["app", "components", "hooks"] as const;

/** Entry owner — defines runTx/awaitReceipt; not a product write site. */
const EXCLUDED_REL = new Set(["hooks/use-tx-sync.ts"]);

/** Primitives that mark a product write-site file (U1 measured set). */
const WRITE_PRIMITIVES: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "runTx(", re: /\brunTx\s*\(/ },
  { name: "awaitReceipt(", re: /\bawaitReceipt\s*\(/ },
  { name: "writeContractAsync", re: /\bwriteContractAsync\b/ },
  { name: "useEvmWriteContract", re: /\buseEvmWriteContract\b/ },
  { name: "useEvmSendTransaction", re: /\buseEvmSendTransaction\b/ },
  { name: "sendTransactionAsync", re: /\bsendTransactionAsync\b/ },
];

/**
 * Enumerated product files that contain at least one write site.
 * Sorted. Line numbers intentionally omitted.
 */
const ENUMERATED_WRITE_FILES: readonly string[] = [
  "components/auction/agent-create-auction-panel.tsx",
  "components/auction/auction-bid-panel.tsx",
  "components/auction/auction-cancel-panel.tsx",
  "components/auction/auction-finalize-panel.tsx",
  "components/auction/auction-settlement-panel.tsx",
  "components/auction/authorize-auction-agent-dialog.tsx",
  "components/auction/create-auction-panel.tsx",
  "components/claims/profile-claims-tab.tsx",
  "components/commerce/agent-lower-commission-panel.tsx",
  "components/commerce/commerce-pause-ops-row.tsx",
  "components/commerce/commerce-revoke-token-row.tsx",
  "components/commerce/owner-lower-floor-panel.tsx",
  "components/commerce/owner-recall-panel.tsx",
  "components/kar-pro/kar-pro-fee-section.tsx",
  "components/kar-pro/kar-pro-join-form.tsx",
  "components/kar-pro/kar-pro-membership-section.tsx",
  "components/kar-pro/kar-pro-profile-section.tsx",
  "components/marketplace/agent-authorization-status.tsx",
  "components/marketplace/agent-delist-button.tsx",
  "components/marketplace/agent-list-on-behalf-panel.tsx",
  "components/marketplace/agent-update-listing-panel.tsx",
  "components/marketplace/authorize-agent-dialog.tsx",
  "components/marketplace/listing-buy-panel.tsx",
  "components/marketplace/listing-edit-client.tsx",
  "components/marketplace/listing-offers-panel.tsx",
  "components/passport/create-passport-wizard.tsx",
  "components/passport/edit-passport-wizard.tsx",
  "components/passport/passport-actions-panel.tsx",
  "components/verifier/verification-payment-modal.tsx",
  "hooks/use-bridge.ts",
  "hooks/use-passport-approval.ts",
  "hooks/use-set-passport-uri.ts",
].sort();

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function toRel(abs: string): string {
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

function fileHasWriteSite(source: string): boolean {
  return WRITE_PRIMITIVES.some(({ re }) => re.test(source));
}

function detectWriteFiles(): string[] {
  const found: string[] = [];
  for (const root of PRODUCT_ROOTS) {
    for (const abs of listTsFiles(path.join(ROOT, root))) {
      const rel = toRel(abs);
      if (EXCLUDED_REL.has(rel)) continue;
      const text = fs.readFileSync(abs, "utf8");
      if (fileHasWriteSite(text)) found.push(rel);
    }
  }
  return found.sort();
}

describe("svm write census policy", () => {
  it("enumerated write files match detected product write-site files (both directions)", () => {
    const detected = detectWriteFiles();
    const enumerated = [...ENUMERATED_WRITE_FILES].sort();

    assert.equal(
      detected.length,
      enumerated.length,
      `file count drift: detected=${detected.length} enumerated=${enumerated.length}`,
    );
    assert.deepEqual(
      detected,
      enumerated,
      [
        "write-file set drift",
        `missing from enum: ${detected.filter((f) => !enumerated.includes(f)).join(", ") || "(none)"}`,
        `extra in enum: ${enumerated.filter((f) => !detected.includes(f)).join(", ") || "(none)"}`,
      ].join(" | "),
    );

    // Compared objects: one sorted file path per write-site file.
    assert.equal(detected.length, 32);
    assert.ok(
      detected.includes("hooks/use-passport-approval.ts"),
      "passport approval owner must be in the write-file set (runTx grep undercount)",
    );
    assert.ok(
      detected.includes("hooks/use-set-passport-uri.ts"),
      "set-passport-uri port hook must be in the write-file set",
    );
  });

  it("constructed: enumerated file without a write site is red", () => {
    const plantedRel = "hooks/use-active-account.ts";
    const plantedAbs = path.join(ROOT, plantedRel);
    assert.ok(fs.existsSync(plantedAbs), "plant target must exist");
    const text = fs.readFileSync(plantedAbs, "utf8");
    assert.equal(
      fileHasWriteSite(text),
      false,
      "plant target must not already be a write-site file",
    );

    const dirtyEnum = [...ENUMERATED_WRITE_FILES, plantedRel].sort();
    const detected = detectWriteFiles();
    const extra = dirtyEnum.filter((f) => !detected.includes(f));
    assert.deepEqual(extra, [plantedRel]);
    assert.notDeepEqual(detected, dirtyEnum);
  });

  it("constructed: write-site file omitted from enum is red", () => {
    const omitted = "hooks/use-passport-approval.ts";
    assert.ok(
      ENUMERATED_WRITE_FILES.includes(omitted),
      "omission plant must be a real write-site file",
    );
    const shrunk = ENUMERATED_WRITE_FILES.filter((f) => f !== omitted);
    const detected = detectWriteFiles();
    const missing = detected.filter((f) => !shrunk.includes(f));
    assert.deepEqual(missing, [omitted]);
    assert.notDeepEqual(detected, shrunk);
  });

  it("does not read the local research census annex from disk", () => {
    const self = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
    // Ban runtime reads of docs/research (gitignored annex). Comments may
    // mention the annex class; path literals in readFileSync/import are defects.
    assert.doesNotMatch(self, /readFileSync\([^)]*docs\/research/);
    assert.doesNotMatch(self, /from\s+["'][^"']*docs\/research/);
    assert.doesNotMatch(self, /fs\.promises\.readFile\([^)]*docs\/research/);
  });
});
