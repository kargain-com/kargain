/**
 * S8-1 — no VM branching in app/components (forks stay in lib owners).
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

const SCAN_ROOTS = ["app", "components"] as const;

/** VM / stack.vm branching patterns that belong in lib entry points only. */
const VM_BRANCH_PATTERNS = [
  /\bvm\s*===\s*["'](?:evm|svm)["']/,
  /\bvm\s*!==\s*["'](?:evm|svm)["']/,
  /\.vm\s*===\s*["'](?:evm|svm)["']/,
  /\.vm\s*!==\s*["'](?:evm|svm)["']/,
  /stack\.vm\b/,
  /["']\.vm["']/,
] as const;

function walkTsFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walkTsFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

export function vmBranchViolationInSource(source: string): boolean {
  return VM_BRANCH_PATTERNS.some((re) => re.test(source));
}

function findVmBranchViolations(): { path: string; reason: string }[] {
  const violations: { path: string; reason: string }[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walkTsFiles(join(ROOT, root))) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const src = readFileSync(file, "utf8");
      if (vmBranchViolationInSource(src)) {
        violations.push({
          path: rel,
          reason: "vm / stack.vm branch in app or components",
        });
      }
    }
  }
  return violations;
}

describe("network VM component policy (S8-1)", () => {
  it("no app/components file branches on vm or stack.vm", () => {
    const violations = findVmBranchViolations();
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("constructed dirty component is red", () => {
    const dirty = `
export function Bad({ stack }: { stack: { vm: string } }) {
  if (stack.vm === "svm") return null;
  return null;
}
`;
    assert.equal(vmBranchViolationInSource(dirty), true);
  });

  it("clean consumer without vm branch is green", () => {
    const clean = `
import { explorerAddressUrl } from "@/lib/web3/network-explorer";
export function Ok({ stack, addr }: { stack: never; addr: string }) {
  return <a href={explorerAddressUrl(stack, addr)} />;
}
`;
    assert.equal(vmBranchViolationInSource(clean), false);
  });
});
