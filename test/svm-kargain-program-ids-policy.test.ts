/**
 * SvmKargainProgramIds is the sole commercial Kargain program-id shape.
 * Exhaustiveness by construction: a stack assignable without a required
 * program field fails typecheck (tsc probe under mkdtemp).
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  svmKargainProgramIds,
  type SvmCommercialActiveStack,
  type SvmKargainProgramIds,
} from "@/lib/web3/commercial-active";
import { FIXTURE_SVM_STACK } from "./fixtures/commercial-svm-stack.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runAssignabilityProbe(source: string): {
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
  it("svmKargainProgramIds returns live fixture passport/gateway/modes", () => {
    const ids = svmKargainProgramIds(FIXTURE_SVM_STACK);
    assert.ok(ids.includes(FIXTURE_SVM_STACK.karPassport));
    assert.ok(ids.includes(FIXTURE_SVM_STACK.bridgeGateway));
    assert.ok(ids.includes(FIXTURE_SVM_STACK.karProStaking));
    assert.ok(ids.includes(FIXTURE_SVM_STACK.karProPass));
  });

  it("stack missing required karPassport fails assignability (type exhaustiveness)", () => {
    const red = runAssignabilityProbe(`
import type { SvmKargainProgramIds } from "@/lib/web3/commercial-active";

const bad: SvmKargainProgramIds = {
  karProPass: "a",
  karProStaking: "b",
  bridgeGateway: "c",
};
void bad;
`);
    assert.notEqual(red.status, 0, `expected tsc red, got:\n${red.out}`);
    assert.match(red.out, /karPassport/);

    const green = runAssignabilityProbe(`
import type { SvmCommercialActiveStack, SvmKargainProgramIds } from "@/lib/web3/commercial-active";
import { FIXTURE_SVM_STACK } from "${path.join(ROOT, "test/fixtures/commercial-svm-stack.ts").replace(/\\/g, "/")}";

const programs: SvmKargainProgramIds = {
  karPassport: FIXTURE_SVM_STACK.karPassport,
  karProPass: FIXTURE_SVM_STACK.karProPass,
  karProStaking: FIXTURE_SVM_STACK.karProStaking,
  bridgeGateway: FIXTURE_SVM_STACK.bridgeGateway,
  fixedPriceConsignment: FIXTURE_SVM_STACK.fixedPriceConsignment,
  ascendingConsignment: FIXTURE_SVM_STACK.ascendingConsignment,
};
const ok: SvmCommercialActiveStack = { ...FIXTURE_SVM_STACK, ...programs };
void ok;
`);
    assert.equal(green.status, 0, `expected tsc green, got:\n${green.out}`);
  });

  it("landed-error owner has no KARGAIN_PROGRAM_FIELDS hand-list", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "lib/web3/svm-landed-error.ts"),
      "utf8",
    );
    assert.doesNotMatch(src, /KARGAIN_PROGRAM_FIELDS/);
    assert.match(src, /svmKargainProgramIds/);
  });
});
