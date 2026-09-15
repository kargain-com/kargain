/**
 * Policy suites must not mutate the live scanned product tree.
 * Negative controls live in memory or under mkdtemp outside the repository.
 * Scanned roots: app | components | hooks | lib | src | scripts.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

const FORBIDDEN_ROOT =
  "(?:app|components|hooks|lib|src|scripts)";

const MUTATOR =
  "(?:writeFileSync|mkdirSync|rmSync|appendFileSync|cpSync|renameSync|unlinkSync)";

const MUTATOR_CALL = `(?:\\w+\\.)?${MUTATOR}`;

/**
 * Detect suite source that mutates a path under a scanned product root
 * joined to the real repository (ROOT / POLICY_SCAN_ROOT).
 * Temp-root plants (mkdtemp / tmpdir → join(temp, "lib/…")) must not match.
 */
export function findScannedTreeMutationsInSuiteSource(
  source: string,
): { reason: string }[] {
  const hits: { reason: string }[] = [];

  const relConsts = new Map<string, string>();
  const relConstRe = new RegExp(
    `const\\s+(\\w+)\\s*=\\s*["'](${FORBIDDEN_ROOT}\\/[^"']*)["']`,
    "g",
  );
  for (const m of source.matchAll(relConstRe)) {
    relConsts.set(m[1]!, m[2]!);
  }

  const absConsts = new Map<string, string>();
  const absLiteralRe = new RegExp(
    `const\\s+(\\w+)\\s*=\\s*(?:path\\.)?join\\(\\s*(?:ROOT|POLICY_SCAN_ROOT)\\s*,\\s*["'](${FORBIDDEN_ROOT}\\/[^"']*)["']`,
    "g",
  );
  for (const m of source.matchAll(absLiteralRe)) {
    absConsts.set(m[1]!, m[2]!);
  }
  const absViaRelRe =
    /const\s+(\w+)\s*=\s*(?:path\.)?join\(\s*(?:ROOT|POLICY_SCAN_ROOT)\s*,\s*(\w+)\s*\)/g;
  for (const m of source.matchAll(absViaRelRe)) {
    const rel = relConsts.get(m[2]!);
    if (rel) absConsts.set(m[1]!, rel);
  }

  const directJoinMutator = new RegExp(
    `${MUTATOR_CALL}\\s*\\(\\s*(?:path\\.)?join\\(\\s*(?:ROOT|POLICY_SCAN_ROOT)\\s*,\\s*["']${FORBIDDEN_ROOT}\\/`,
  );
  if (directJoinMutator.test(source)) {
    hits.push({
      reason: "mutator joins ROOT/POLICY_SCAN_ROOT to a scanned product root",
    });
  }

  for (const [absName, rel] of absConsts) {
    const callRe = new RegExp(
      `${MUTATOR_CALL}\\s*\\(\\s*${absName}\\b`,
    );
    if (callRe.test(source)) {
      hits.push({
        reason: `mutator targets ROOT-joined scanned path ${rel}`,
      });
    }
  }

  return hits;
}

export type SuiteScannedTreeMutation = {
  path: string;
  reasons: string[];
};

/** Walk every `test/*.test.ts` suite; report mutations into scanned product roots. */
export function findScannedTreeMutationsInTestSuites(
  testDir: string = TEST_DIR,
): { suitesCompared: number; violations: SuiteScannedTreeMutation[] } {
  const names = readdirSync(testDir)
    .filter((n) => n.endsWith(".test.ts"))
    .sort();
  const violations: SuiteScannedTreeMutation[] = [];
  for (const name of names) {
    const source = readFileSync(join(testDir, name), "utf8");
    const reasons = findScannedTreeMutationsInSuiteSource(source).map(
      (h) => h.reason,
    );
    if (reasons.length > 0) {
      violations.push({ path: `test/${name}`, reasons });
    }
  }
  return { suitesCompared: names.length, violations };
}

describe("policy-suite-scanned-tree-mutation-policy", () => {
  it("live test/*.test.ts suites do not mutate scanned product roots", () => {
    const { suitesCompared, violations } =
      findScannedTreeMutationsInTestSuites();
    assert.ok(
      suitesCompared >= 300,
      `expected a full suite walk (≥300), got ${suitesCompared}`,
    );
    assert.deepEqual(
      violations,
      [],
      `suites mutate scanned roots (${suitesCompared} compared):\n${JSON.stringify(violations, null, 2)}`,
    );
  });

  it("planted ROOT-join writeFileSync is red then green (in-memory)", () => {
    // Assembled at runtime so this suite file itself does not match the detector.
    const plantedRel = ["scripts", "_planted-writer.ts"].join("/");
    const dirty = [
      'const ROOT = "/repo";',
      `const plantedRel = ${JSON.stringify(plantedRel)};`,
      "const plantedAbs = join(" + "ROOT, plantedRel);",
      "writeFile" + "Sync(plantedAbs, \"export {}\");",
      "rm" + "Sync(plantedAbs, { force: true });",
    ].join("\n");
    const dirtyHits = findScannedTreeMutationsInSuiteSource(dirty);
    assert.ok(
      dirtyHits.length >= 1,
      `expected planted ROOT mutation red, got ${JSON.stringify(dirtyHits)}`,
    );
    assert.match(dirtyHits[0]!.reason, /scanned path scripts\//);

    const cleanRel = ["scripts", "_planted-writer.ts"].join("/");
    const clean = [
      'const root = mkdtempSync(join(tmpdir(), "kargain-plant-"));',
      'mkdirSync(join(root, "scripts"), { recursive: true });',
      `writeFileSync(join(root, ${JSON.stringify(cleanRel)}), "export {}");`,
      "rmSync(root, { recursive: true, force: true });",
    ].join("\n");
    assert.deepEqual(findScannedTreeMutationsInSuiteSource(clean), []);
  });

  it("planted path.join(ROOT, src/…) probe is red; mkdtemp probe is green", () => {
    const probeRel = ["src", "lib", "__probe.ts"].join("/");
    const dirty = [
      `const probe = path.join(ROOT, ${JSON.stringify(probeRel)});`,
      "fs.writeFile" + "Sync(probe, \"x\");",
      "fs.rm" + "Sync(probe, { force: true });",
    ].join("\n");
    const hits = findScannedTreeMutationsInSuiteSource(dirty);
    assert.ok(
      hits.some((h) => /src\/lib\/__probe/.test(h.reason)),
      `expected src probe hit, got ${JSON.stringify(hits)}`,
    );

    const clean = [
      'const tmp = mkdtempSync(join(tmpdir(), "kargain-probe-"));',
      'const probe = join(tmp, "probe.ts");',
      'writeFileSync(probe, "x");',
      "rmSync(tmp, { recursive: true, force: true });",
    ].join("\n");
    assert.deepEqual(findScannedTreeMutationsInSuiteSource(clean), []);
  });
});
