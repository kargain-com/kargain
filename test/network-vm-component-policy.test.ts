/**
 * S8-1-fix — no VM branching in product code outside allowlisted lib owners.
 * Uses the sole product policy scanner (app|components|hooks|lib).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

/**
 * Lib modules allowed to fork on `vm` / `stack.vm` (network-class entry points).
 * app / components / hooks allowlist is empty.
 */
export const VM_BRANCH_ALLOWLIST = [
  "lib/web3/active-account.ts",
  "lib/web3/chain-context.ts",
  "lib/web3/chain-selector-state.ts",
  "lib/web3/commercial-active.ts",
  "lib/web3/deployment-addresses.ts",
  "lib/web3/evm-account-adapter.ts",
  "lib/web3/evm-write-lifecycle.ts",
  "lib/web3/keyed-multicall.ts",
  "lib/web3/protocol-address.ts",
  "lib/web3/network-explorer.ts",
  "lib/web3/svm-account-adapter.ts",
  "lib/web3/svm-account-session.tsx",
  "lib/web3/svm-wallet-discovery.ts",
  "lib/web3/svm-write-lifecycle.ts",
  "lib/web3/tx-write-availability.ts",
  // S8-D0 sole capability × namespace support reader — indexes support by stack.vm.
  "lib/web3/surface-support.ts",
  "lib/web3/write-lifecycle.ts",
  "lib/storage/irys-upload-plan.ts",
  // П-8 Irys session door — account.vm fork lives here, not in wizards.
  "lib/passport/upload-passport-metadata.ts",
  // U6 set-URI write owner — VM fork for EVM/SVM arms; panels stay blind.
  "lib/passport/set-passport-uri.ts",
  // U6.1 edit-write prep — EVM switch+SIWE vs named SVM none-required; panels stay blind.
  "lib/passport/prepare-passport-edit-write.ts",
  // U6.3 AppendRecord write owner + evidence-file SIWE prep; panels stay blind.
  "lib/passport/append-passport-record.ts",
  "lib/passport/prepare-passport-record-write.ts",
  // U6.4 ReportDiscrepancy write owner — separate assembler; panels stay blind.
  "lib/passport/report-passport-discrepancy.ts",
  // U6.5 AppendAttestation write owner + active-verifier admission fact.
  "lib/passport/append-passport-attestation.ts",
  "lib/verifier/active-verifier-fact.ts",
  // U6.6 VerifyPassport write owner — derive-only five metas; panels stay blind.
  "lib/passport/verify-passport.ts",
  // U6.7.1 OpenChallenge write owner + bond disclosure — panels stay blind.
  "lib/passport/open-challenge.ts",
  "lib/passport/challenge-bond-disclosure.ts",
  // U6.7.2 WithdrawChallenge write owner — panels stay blind (disclosure shared).
  "lib/passport/withdraw-challenge.ts",
  // U6.7.4 JudgeChallenge write owner — chain-resolved bond recipient; panels stay blind.
  "lib/passport/judge-challenge.ts",
  // U6.7.5 ConcludeChallenge write owner — forfeit-only recipient; panels stay blind.
  "lib/passport/conclude-challenge.ts",
  // U9.2a passport commerce chrome reads — EVM batch vs SVM PassportState; panels stay blind.
  "lib/passport/passport-commerce-facts.ts",
  // S8-D1 9.3c May simulate — fee payer + planVm decision; hook stays blind.
  "lib/passport/simulate-passport-may.ts",
  // U6.2 verification-fee write owner + surface/hub admit — panels stay blind.
  "lib/verifier/set-verification-fee.ts",
  "lib/verifier/verification-fee-surface.ts",
  "lib/kar-pro/kar-pro-hub-admit.ts",
  // S8-D4 unit 3 FixedPrice OpenDirect — dual-VM commerce owner; panels stay blind.
  "lib/commerce/open-fixed-price-consignment.ts",
] as const;

/**
 * VM / stack.vm branching, plus any property compared to the literals
 * "evm" / "svm" (U6.2-fix — kind-rename evasion).
 */
const VM_BRANCH_PATTERNS = [
  /\bvm\s*===\s*["'](?:evm|svm)["']/,
  /\bvm\s*!==\s*["'](?:evm|svm)["']/,
  /\.vm\s*===\s*["'](?:evm|svm)["']/,
  /\.vm\s*!==\s*["'](?:evm|svm)["']/,
  /stack\.vm\b/,
  /["']\.vm["']/,
  // U6.2-fix: surface.kind / hub.kind / opt.family — any .prop === "evm"|"svm"
  /\.\w+\s*===\s*["'](?:evm|svm)["']/,
  /\.\w+\s*!==\s*["'](?:evm|svm)["']/,
] as const;

export function vmBranchViolationInSource(source: string): boolean {
  return VM_BRANCH_PATTERNS.some((re) => re.test(source));
}

function vmPredicate(rel: string, source: string): string | false {
  if (!vmBranchViolationInSource(source)) return false;
  return `vm / stack.vm / kind-literal branch outside allowlist (${rel})`;
}

describe("network VM component policy (S8-1-fix)", () => {
  it("no product file outside allowlist branches on vm, stack.vm, or kind-literals", () => {
    const scan = scanProductSources(vmPredicate, {
      owners: VM_BRANCH_ALLOWLIST,
    });
    assertCleanProductScan(scan, { owners: VM_BRANCH_ALLOWLIST });
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

  it("U6.2-fix: kind-rename evasion (any .prop === evm|svm) is red", () => {
    const kindEvasion = `
const isEvmSurface = surface.kind === "evm";
const isSvmSurface = surface.kind === "svm";
`;
    assert.equal(
      vmBranchViolationInSource(kindEvasion),
      true,
      "pre-fix fee panel kind fork must be red under extended scanner",
    );
    const renamedProp = `
if (surface.lane === "svm") return null;
`;
    assert.equal(
      vmBranchViolationInSource(renamedProp),
      true,
      "renamed property still compared to svm must be red",
    );
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
      `vm / stack.vm / kind-literal branch outside allowlist (hooks/use-invented-vm.ts)`,
    );
    const live = scanProductSources(vmPredicate, {
      owners: VM_BRANCH_ALLOWLIST,
    });
    assertCleanProductScan(live, { owners: VM_BRANCH_ALLOWLIST });
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
