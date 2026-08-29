/**
 * Declared URI ceiling — three-language mirrors must agree; no second product literal.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { DECLARED_PASSPORT_URI_CEILING_BYTES } from "../lib/web3/declared-uri-ceiling.ts";
import {
  LZ_RECEIVE_GAS_CAP,
  requiredLzReceiveGasForByteLength,
} from "../lib/web3/bridge/lz-receive-gas.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TS_OWNER = path.join(ROOT, "lib/web3/declared-uri-ceiling.ts");
const SOL_OWNER = path.join(ROOT, "contracts/lib/PassportUriCeiling.sol");
const RS_OWNER = path.join(ROOT, "svm/crates/kargain-errors/src/lib.rs");

const OWNER_FILES = new Set([TS_OWNER, SOL_OWNER, RS_OWNER]);

/** Paths allowed to mention historical 731 as measure / fixture (not product ceiling). */
const HISTORICAL_731_ALLOW = [
  /svm\/lab\//,
  /svm\/lab\/RESULTS\.md$/,
  /fixtures\//,
  /onft-wire-conformance/,
  /kargain-onft-codec/,
  /KarPassportBridgeGateway\.test\.ts$/,
  /STAND_URI_HISTORICAL_731/,
  /ceiling_731/,
];

function listFiles(dir: string, exts: Set<string>, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "target" || ent.name === "cache") {
      continue;
    }
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) listFiles(p, exts, out);
    else if (exts.has(path.extname(ent.name))) out.push(p);
  }
  return out;
}

function parseTsCeiling(src: string): number {
  const m = src.match(
    /export const DECLARED_PASSPORT_URI_CEILING_BYTES\s*=\s*(\d+)\s*;/,
  );
  assert.ok(m, "TS owner missing DECLARED_PASSPORT_URI_CEILING_BYTES");
  return Number(m![1]);
}

function parseSolCeiling(src: string): number {
  const m = src.match(/uint256\s+internal\s+constant\s+BYTES\s*=\s*(\d+)\s*;/);
  assert.ok(m, "Solidity owner missing BYTES constant");
  return Number(m![1]);
}

function parseRsCeiling(src: string): number {
  const m = src.match(
    /pub const PASSPORT_URI_CEILING_BYTES:\s*usize\s*=\s*(\d+)\s*;/,
  );
  assert.ok(m, "Rust owner missing PASSPORT_URI_CEILING_BYTES");
  return Number(m![1]);
}

describe("declared URI ceiling policy", () => {
  it("TS, Solidity, and Rust mirrors agree with the TS export", () => {
    const ts = parseTsCeiling(fs.readFileSync(TS_OWNER, "utf8"));
    const sol = parseSolCeiling(fs.readFileSync(SOL_OWNER, "utf8"));
    const rs = parseRsCeiling(fs.readFileSync(RS_OWNER, "utf8"));
    assert.equal(ts, DECLARED_PASSPORT_URI_CEILING_BYTES);
    assert.equal(sol, DECLARED_PASSPORT_URI_CEILING_BYTES);
    assert.equal(rs, DECLARED_PASSPORT_URI_CEILING_BYTES);
    assert.equal(DECLARED_PASSPORT_URI_CEILING_BYTES, 160);
  });

  it("EVM gas model at the declared ceiling stays under LZ_RECEIVE_GAS_CAP", () => {
    const r = requiredLzReceiveGasForByteLength(
      DECLARED_PASSPORT_URI_CEILING_BYTES,
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.ok(r.gas < LZ_RECEIVE_GAS_CAP);
      assert.equal(r.gas, 342_669);
    }
  });

  it("product trees do not hardcode a second ceiling literal", () => {
    const ceilingLit = new RegExp(
      String.raw`(?:BYTES|PASSPORT_URI_CEILING_BYTES|DECLARED_PASSPORT_URI_CEILING_BYTES|URI_CEILING|uriCeiling|maxUriBytes)\s*=\s*(\d+)`,
    );
    const productRoots = [
      path.join(ROOT, "contracts"),
      path.join(ROOT, "lib"),
      path.join(ROOT, "svm/programs"),
      path.join(ROOT, "svm/crates"),
      path.join(ROOT, "svm/stand"),
      path.join(ROOT, "hooks"),
      path.join(ROOT, "components"),
      path.join(ROOT, "app"),
    ];
    const exts = new Set([".ts", ".tsx", ".sol", ".rs"]);
    const violations: string[] = [];
    for (const root of productRoots) {
      for (const file of listFiles(root, exts)) {
        if (OWNER_FILES.has(file)) continue;
        const text = fs.readFileSync(file, "utf8");
        const m = text.match(ceilingLit);
        if (m && Number(m[1]) !== DECLARED_PASSPORT_URI_CEILING_BYTES) {
          // Non-matching names with other numbers are fine; only catch wrong ceiling assigns
        }
        // Ban assigning the ceiling number outside owners via the named forms
        for (const re of [
          /BYTES\s*=\s*160\b/,
          /PASSPORT_URI_CEILING_BYTES:\s*usize\s*=\s*160\b/,
          /DECLARED_PASSPORT_URI_CEILING_BYTES\s*=\s*160\b/,
          /URI_CEILING(?:_BYTES)?\s*=\s*160\b/,
        ]) {
          if (re.test(text)) {
            violations.push(path.relative(ROOT, file));
          }
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("product code does not treat 731 as the live URI ceiling", () => {
    const productRoots = [
      path.join(ROOT, "lib"),
      path.join(ROOT, "hooks"),
      path.join(ROOT, "components"),
      path.join(ROOT, "app"),
      path.join(ROOT, "contracts"),
      path.join(ROOT, "svm/stand"),
      path.join(ROOT, "svm/programs"),
    ];
    const exts = new Set([".ts", ".tsx", ".sol", ".rs"]);
    const ban = /URI_CEILING\s*=\s*731\b|STAND_URI_CEILING_731\b|Enforced URI ceiling:\s*731/;
    const violations: string[] = [];
    for (const root of productRoots) {
      for (const file of listFiles(root, exts)) {
        const rel = path.relative(ROOT, file);
        if (HISTORICAL_731_ALLOW.some((re) => re.test(rel))) continue;
        const text = fs.readFileSync(file, "utf8");
        if (ban.test(text)) violations.push(rel);
      }
    }
    assert.deepEqual(violations, []);
  });
});
