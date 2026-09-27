/**
 * Ban eslint-disable in product roots (app / components / hooks / lib).
 * Plantable scanner — red when a disable comment appears outside declared owners.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

/** Detect eslint-disable directives (line, next-line, block) — not prose mentions. */
export function findEslintDisableViolations(
  sources: ReadonlyArray<{ path: string; text: string }>,
): string[] {
  const out: string[] = [];
  for (const { path: filePath, text } of sources) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (
        /(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?\b/.test(line)
      ) {
        out.push(`${filePath}:${i + 1}`);
      }
    }
  }
  return out;
}

describe("product-eslint-disable-policy", () => {
  it("planted eslint-disable in hooks is red; live product roots are clean (1→0)", () => {
    const planted = findEslintDisableViolations([
      {
        path: "hooks/use-passport-commerce-facts.ts",
        text: [
          "useEffect(() => {",
          "  // eslint-disable-next-line react-hooks/exhaustive-deps -- key/feePayer",
          "}, [simulateArgs?.key]);",
        ].join("\n"),
      },
    ]);
    assert.deepEqual(planted, [
      "hooks/use-passport-commerce-facts.ts:2",
    ]);

    const scan = scanProductSources((rel, src) => {
      const hits = findEslintDisableViolations([{ path: rel, text: src }]);
      return hits.length > 0 ? hits.join("; ") : false;
    });
    assertCleanProductScan(scan);
  });
});
