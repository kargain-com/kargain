/**
 * Ban `new Error(sentenceFn(...))` inside write-lifecycle owners.
 * Guard refusals must throw {@link TxWriteGuardRefusal} with the typed payload.
 * In-memory plant only — never mutates live product tree.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const LIFECYCLE_FILES = [
  "lib/web3/write-lifecycle.ts",
  "lib/web3/evm-write-lifecycle.ts",
  "lib/web3/svm-write-lifecycle.ts",
] as const;

/** `new Error(` whose argument is a *RefusalMessage / *Copy call. */
const SENTENCE_THROW =
  /new\s+Error\s*\(\s*(?:[A-Za-z_$][\w$]*RefusalMessage|[A-Za-z_$][\w$]*Copy)\s*\(/;

function findSentenceThrows(source: string): string[] {
  const hits: string[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (SENTENCE_THROW.test(lines[i]!)) {
      hits.push(`L${i + 1}: ${lines[i]!.trim()}`);
    }
  }
  return hits;
}

function scanLifecycleRoots(rootDir: string): {
  filesRead: number;
  violations: string[];
} {
  const violations: string[] = [];
  let filesRead = 0;
  for (const rel of LIFECYCLE_FILES) {
    const abs = path.join(rootDir, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    filesRead += 1;
    const src = readFileSync(abs, "utf8");
    for (const hit of findSentenceThrows(src)) {
      violations.push(`${rel}: ${hit}`);
    }
  }
  return { filesRead, violations };
}

describe("write-lifecycle-sentence-throw-policy", () => {
  it("live write-lifecycle files have no new Error(sentenceFn(...))", () => {
    const { filesRead, violations } = scanLifecycleRoots(ROOT);
    assert.equal(filesRead, LIFECYCLE_FILES.length);
    assert.deepEqual(violations, [], violations.join("\n"));
  });

  it("constructed plant: new Error(txWriteRefusalMessage(...)) is red", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lifecycle-sentence-"));
    const libWeb3 = path.join(dir, "lib/web3");
    mkdirSync(libWeb3, { recursive: true });
    writeFileSync(
      path.join(libWeb3, "write-lifecycle.ts"),
      `
import { txWriteRefusalMessage } from "./tx-write-availability";
export function bad(avail: { available: false; cause: "disconnected" }) {
  throw new Error(txWriteRefusalMessage(avail));
}
`,
    );
    writeFileSync(path.join(libWeb3, "evm-write-lifecycle.ts"), "// empty\n");
    writeFileSync(path.join(libWeb3, "svm-write-lifecycle.ts"), "// empty\n");

    const plant = scanLifecycleRoots(dir);
    assert.ok(
      plant.violations.some((v) => v.includes("txWriteRefusalMessage")),
      "plant must trip sentence-throw detector",
    );

    writeFileSync(
      path.join(libWeb3, "write-lifecycle.ts"),
      `
import { TxWriteGuardRefusal } from "./tx-write-availability";
export function good(avail: { available: false; cause: "disconnected" }) {
  throw new TxWriteGuardRefusal({
    guard: "write_availability",
    refusal: avail,
  });
}
`,
    );
    const green = scanLifecycleRoots(dir);
    assert.deepEqual(green.violations, []);
  });

  it("switch-chain disconnected uses switch-chain sentence (not write-availability)", async () => {
    const { evmSessionRefusalCopy } = await import(
      "@/lib/web3/active-account"
    );
    const {
      txWriteGuardRefusalCopy,
      txWriteRefusalMessage,
    } = await import("@/lib/web3/tx-write-availability");

    const switchDisconnected = txWriteGuardRefusalCopy({
      guard: "switch_chain",
      refusal: { available: false, cause: "disconnected" },
    });
    const writeDisconnected = txWriteRefusalMessage({
      available: false,
      cause: "disconnected",
    });
    assert.equal(switchDisconnected, evmSessionRefusalCopy("disconnected"));
    assert.notEqual(switchDisconnected, writeDisconnected);
    assert.equal(writeDisconnected, "Connect a wallet to send this transaction.");
  });
});
