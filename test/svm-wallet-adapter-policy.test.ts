/**
 * S8-2 — Solana kit / Wallet Standard / @solana/react only in SVM account owners.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { scanProductSources } from "./policy-scan-helpers.ts";

const SVM_OWNERS = [
  "lib/web3/svm-account-adapter.ts",
  "lib/web3/svm-account-session.tsx",
  "lib/web3/svm-wallet-discovery.ts",
] as const;

const SVM_DEP_IMPORT =
  /from\s*["']@(?:solana\/(?:kit|react)|wallet-standard\/[^"']+)["']/;

function svmDepPredicate(rel: string, source: string): string | false {
  if (!SVM_DEP_IMPORT.test(source)) return false;
  return `Solana wallet dep outside SVM adapter (${rel})`;
}

describe("svm wallet adapter policy (S8-2)", () => {
  it("kit / wallet-standard / solana react stay in SVM owners", () => {
    const violations = scanProductSources(svmDepPredicate, {
      owners: [...SVM_OWNERS],
    });
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("constructed dirty component import is red", () => {
    const dirty = `import { address } from "@solana/kit";\n`;
    assert.equal(
      svmDepPredicate("components/invented-svm.tsx", dirty),
      "Solana wallet dep outside SVM adapter (components/invented-svm.tsx)",
    );
  });

  it("svm-rpc stays green by avoiding wallet deps, and the parked placement stays red for the original reason", () => {
    const source = readFileSync("lib/web3/svm-rpc.ts", "utf8");
    assert.doesNotMatch(source, SVM_DEP_IMPORT);

    const parked = `import { createSolanaRpc } from "@solana/kit";\n`;
    assert.equal(
      svmDepPredicate("lib/web3/svm-rpc.ts", parked),
      "Solana wallet dep outside SVM adapter (lib/web3/svm-rpc.ts)",
    );
  });
});
