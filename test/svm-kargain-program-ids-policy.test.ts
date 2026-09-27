/**
 * SvmKargainProgramIds + SVM_KARGAIN_PROGRAM_FIELDS — exhaustive key table.
 * A new program field on the shape must appear in the table or typecheck fails.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  SVM_KARGAIN_PROGRAM_FIELDS,
  svmKargainProgramIds,
} from "@/lib/web3/commercial-active";
import { FIXTURE_SVM_STACK } from "./fixtures/commercial-svm-stack.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(
  ROOT,
  "test/fixtures/svm-kargain-program-fields-exhaustiveness.ts",
);

function runTscOnFixture(source: string): {
  status: number | null;
  out: string;
} {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kargain-svm-kargain-ids-"));
  const probe = path.join(tmp, "probe.ts");
  const tsconfigPath = path.join(tmp, "tsconfig.json");
  try {
    fs.writeFileSync(
      tsconfigPath,
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["ES2022"],
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "ESNext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            allowImportingTsExtensions: true,
            typeRoots: [path.join(ROOT, "node_modules/@types")],
            paths: {
              "@/*": [path.join(ROOT, "*")],
            },
            baseUrl: ROOT,
          },
          files: [probe],
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(probe, source);
    const result = spawnSync(
      "pnpm",
      ["exec", "tsc", "--noEmit", "-p", tsconfigPath],
      { cwd: ROOT, encoding: "utf8" },
    );
    return {
      status: result.status,
      out: `${result.stdout}\n${result.stderr}`,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe("svm-kargain-program-ids-policy", () => {
  it("svmKargainProgramIds returns exactly the fixture's present program ids", () => {
    const ids = svmKargainProgramIds(FIXTURE_SVM_STACK);
    const expected = [
      FIXTURE_SVM_STACK.karPassport,
      FIXTURE_SVM_STACK.karProPass,
      FIXTURE_SVM_STACK.karProStaking,
      FIXTURE_SVM_STACK.bridgeGateway,
      FIXTURE_SVM_STACK.fixedPriceConsignment,
      FIXTURE_SVM_STACK.ascendingConsignment,
    ].filter((v) => v != null);
    assert.deepEqual([...ids].sort(), [...expected].sort());
  });

  it("SVM_KARGAIN_PROGRAM_FIELDS lists every SvmKargainProgramIds key", () => {
    assert.deepEqual(
      Object.keys(SVM_KARGAIN_PROGRAM_FIELDS).sort(),
      [
        "ascendingConsignment",
        "bridgeGateway",
        "fixedPriceConsignment",
        "karPassport",
        "karProPass",
        "karProStaking",
      ],
    );
  });

  it("incomplete fields table fails typecheck; @ts-expect-error keeps it green (red→green)", () => {
    const live = fs.readFileSync(FIXTURE, "utf8");
    assert.match(live, /\/\/\s*@ts-expect-error/);
    assert.match(live, /fixedPriceConsignment omitted/);

    const withoutDirective = live.replace(
      /^\s*\/\/\s*@ts-expect-error[^\n]*\n/m,
      "",
    );
    assert.doesNotMatch(withoutDirective, /\/\/\s*@ts-expect-error/);

    const red = runTscOnFixture(withoutDirective);
    assert.notEqual(red.status, 0, `expected tsc red, got:\n${red.out}`);
    assert.match(red.out, /fixedPriceConsignment|SvmKargainProgramIds/);

    const green = runTscOnFixture(live);
    assert.equal(green.status, 0, `expected tsc green, got:\n${green.out}`);
  });

  it("landed-error owner has no hand-list; consumes svmKargainProgramIds", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "lib/web3/svm-landed-error.ts"),
      "utf8",
    );
    assert.doesNotMatch(src, /KARGAIN_PROGRAM_FIELDS/);
    assert.match(src, /svmKargainProgramIds/);
    const commercial = fs.readFileSync(
      path.join(ROOT, "lib/web3/commercial-active.ts"),
      "utf8",
    );
    assert.match(commercial, /SVM_KARGAIN_PROGRAM_FIELDS/);
  });
});
