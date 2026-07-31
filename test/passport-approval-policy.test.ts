import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Sole owner of ERC-721 passport approval reads/writes for any spender
 * (modes + gateway). ERC-20 payment-token allowance is a different rule.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_DIRS = [
  path.join(ROOT, "app"),
  path.join(ROOT, "components"),
  path.join(ROOT, "hooks"),
  path.join(ROOT, "lib"),
];

const OWNER = path.join(ROOT, "hooks/use-passport-approval.ts");

/** ERC-721 approval symbols that must live only in the owner. */
const APPROVAL_FUNCTION_NAMES = [
  "getApproved",
  "isApprovedForAll",
  "setApprovalForAll",
  "approve",
] as const;

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

function importsKarPassportAbi(text: string): boolean {
  return (
    /\bKarPassportAbi\b/.test(text) &&
    /from\s+["']@\/lib\/contracts\/abis\.generated["']/.test(text)
  );
}

function approvalSymbolHits(text: string): string[] {
  const hits: string[] = [];
  for (const name of APPROVAL_FUNCTION_NAMES) {
    // Match functionName: "name" / 'name' used in wagmi/viem contract calls.
    const re = new RegExp(
      `functionName\\s*:\\s*["']${name}["']`,
    );
    if (re.test(text)) hits.push(name);
  }
  return hits;
}

describe("passport approval policy", () => {
  it("allows KarPassport ERC-721 approval calls only in use-passport-approval.ts", () => {
    const violations: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        if (file === OWNER) continue;
        // Generated ABI catalog lists every symbol — not a call site.
        if (file.endsWith(`${path.sep}abis.generated.ts`)) continue;
        const text = fs.readFileSync(file, "utf8");
        if (!importsKarPassportAbi(text)) continue;
        const hits = approvalSymbolHits(text);
        if (hits.length > 0) {
          violations.push(
            `${path.relative(ROOT, file)}: ${hits.join(", ")}`,
          );
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("owning module still owns all four approval symbols", () => {
    const text = fs.readFileSync(OWNER, "utf8");
    assert.ok(importsKarPassportAbi(text), "owner must import KarPassportAbi");
    for (const name of APPROVAL_FUNCTION_NAMES) {
      assert.match(
        text,
        new RegExp(`functionName\\s*:\\s*["']${name}["']`),
        `owner must call functionName: "${name}"`,
      );
    }
    assert.match(text, /export function usePassportApproval/);
  });

  it("buy and bid panels stay free of KarPassport approval (ERC-20 approve is separate)", () => {
    const controls = [
      "components/marketplace/listing-buy-panel.tsx",
      "components/auction/auction-bid-panel.tsx",
    ];
    for (const rel of controls) {
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      assert.doesNotMatch(
        text,
        /\bKarPassportAbi\b/,
        `${rel} must not import KarPassportAbi`,
      );
      for (const name of [
        "getApproved",
        "isApprovedForAll",
        "setApprovalForAll",
      ] as const) {
        assert.doesNotMatch(
          text,
          new RegExp(`functionName\\s*:\\s*["']${name}["']`),
          `${rel} must not call ${name}`,
        );
      }
    }
  });
});
