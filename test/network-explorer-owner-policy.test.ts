/**
 * S8-1-fix — explorer URL assembly lives only in network-explorer.
 * Uses the sole product policy scanner (app|components|hooks|lib).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  POLICY_SCAN_ROOT,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const OWNER = "lib/web3/network-explorer.ts";
/** Registry may declare explorerBaseUrl literals; assembly stays in OWNER. */
const ALLOWLIST = [
  OWNER,
  "lib/web3/commercial-active.ts",
] as const;

const FORBIDDEN = [
  /blockExplorers/,
  /sepolia\.basescan\.org/,
  /`[^`]*\/address\/\$\{/,
  /`[^`]*\/tx\/\$\{/,
  /["'][^"']*\/address\/\$\{/,
  /["'][^"']*\/tx\/\$\{/,
] as const;

export function explorerOwnerViolationInSource(
  relPath: string,
  source: string,
): boolean {
  const norm = relPath.replace(/\\/g, "/");
  if ((ALLOWLIST as readonly string[]).includes(norm)) return false;
  return FORBIDDEN.some((re) => re.test(source));
}

function explorerPredicate(
  rel: string,
  source: string,
): string | false {
  if (!explorerOwnerViolationInSource(rel, source)) return false;
  for (const re of FORBIDDEN) {
    if (re.test(source)) return `matches ${re}`;
  }
  return "explorer invent";
}

describe("network explorer owner policy (S8-1-fix)", () => {
  it("no product path assembles explorer URLs outside network-explorer", () => {
    const violations = scanProductSources(explorerPredicate, {
      owners: ALLOWLIST,
    });
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("constructed wallet-button fixture is red", () => {
    const dirty = `
const explorer = getViemChain(id)?.blockExplorers?.default?.url ?? "https://sepolia.basescan.org";
const url = \`\${explorer}/address/\${addr}\`;
`;
    assert.equal(
      explorerOwnerViolationInSource("components/wallet-login-button.tsx", dirty),
      true,
    );
  });

  it("constructed invent under hooks/ (old scope miss) is red, live tree green", () => {
    const dirty = `
export function bad() {
  return \`https://sepolia.basescan.org/tx/\${hash}\`;
}
`;
    assert.equal(
      explorerOwnerViolationInSource("hooks/use-bridge.ts", dirty),
      true,
    );
    const live = scanProductSources(explorerPredicate, { owners: ALLOWLIST });
    assert.deepEqual(live, []);
  });

  it("owner module itself is exempt", () => {
    const ownerSrc = readFileSync(join(POLICY_SCAN_ROOT, OWNER), "utf8");
    assert.equal(explorerOwnerViolationInSource(OWNER, ownerSrc), false);
  });

  it("product tree must not import the tests-only SVM fixture", () => {
    const ban = /fixtures\/commercial-svm-stack|commercial-svm-stack/;
    const hits = scanProductSources((_rel, source) =>
      ban.test(source) ? "imports commercial-svm-stack fixture" : false,
    );
    assert.deepEqual(hits, []);
  });
});
