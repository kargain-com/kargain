/**
 * S8-1-fix — no VM branching in product code outside allowlisted lib owners.
 * Uses the sole product policy scanner (app|components|hooks|lib).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scanProductSources } from "./policy-scan-helpers.ts";

/**
 * Lib modules allowed to fork on `vm` / `stack.vm` (network-class entry points).
 * app / components / hooks allowlist is empty.
 */
export const VM_BRANCH_ALLOWLIST = [
  "lib/web3/chain-context.ts",
  "lib/web3/commercial-active.ts",
  "lib/web3/deployment-addresses.ts",
  "lib/web3/protocol-address.ts",
  "lib/web3/network-explorer.ts",
] as const;

/** VM / stack.vm branching patterns that belong in allowlisted lib owners only. */
const VM_BRANCH_PATTERNS = [
  /\bvm\s*===\s*["'](?:evm|svm)["']/,
  /\bvm\s*!==\s*["'](?:evm|svm)["']/,
  /\.vm\s*===\s*["'](?:evm|svm)["']/,
  /\.vm\s*!==\s*["'](?:evm|svm)["']/,
  /stack\.vm\b/,
  /["']\.vm["']/,
] as const;

export function vmBranchViolationInSource(source: string): boolean {
  return VM_BRANCH_PATTERNS.some((re) => re.test(source));
}

function vmPredicate(rel: string, source: string): string | false {
  if (!vmBranchViolationInSource(source)) return false;
  return `vm / stack.vm branch outside allowlist (${rel})`;
}

describe("network VM component policy (S8-1-fix)", () => {
  it("no product file outside allowlist branches on vm or stack.vm", () => {
    const violations = scanProductSources(vmPredicate, {
      owners: VM_BRANCH_ALLOWLIST,
    });
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

  it("constructed dirty hook (old scope miss) is red, live tree green", () => {
    const dirty = `
export function useBad(stack: { vm: string }) {
  return stack.vm === "evm";
}
`;
    assert.equal(vmBranchViolationInSource(dirty), true);
    assert.equal(
      vmPredicate("hooks/use-invented-vm.ts", dirty),
      `vm / stack.vm branch outside allowlist (hooks/use-invented-vm.ts)`,
    );
    const live = scanProductSources(vmPredicate, {
      owners: VM_BRANCH_ALLOWLIST,
    });
    assert.deepEqual(live, []);
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
