import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  filterVerifierDirectoryEntries,
  resolveEffectiveVerifierActive,
} from "../lib/verifier/effective-verifier.ts";

describe("resolveEffectiveVerifierActive", () => {
  it("success uses chain active (including inactive)", () => {
    assert.equal(resolveEffectiveVerifierActive("success", true, false), true);
    assert.equal(resolveEffectiveVerifierActive("success", false, true), false);
    assert.equal(resolveEffectiveVerifierActive("success", null, true), false);
  });

  it("failure falls back to ponder active", () => {
    assert.equal(resolveEffectiveVerifierActive("failure", false, true), true);
    assert.equal(resolveEffectiveVerifierActive("failure", true, false), false);
    assert.equal(resolveEffectiveVerifierActive("failure", null, true), true);
  });
});

describe("filterVerifierDirectoryEntries", () => {
  const A = "0xcFe194fea9727bD04dA8F78c2362680986e02dF1";
  const B = "0x1111111111111111111111111111111111111111";

  const rows = [
    { address: A, active: true, name: "a" },
    { address: B, active: true, name: "b" },
  ];

  it("success keeps only chain-active rows", () => {
    const map = new Map<string, boolean>([[A.toLowerCase(), true]]);
    const filtered = filterVerifierDirectoryEntries(rows, "success", map);
    assert.deepEqual(
      filtered.map((r) => r.name),
      ["a"],
    );
  });

  it("success hides ponder-active when chain inactive", () => {
    const map = new Map<string, boolean>([
      [A.toLowerCase(), false],
      [B.toLowerCase(), false],
    ]);
    assert.deepEqual(filterVerifierDirectoryEntries(rows, "success", map), []);
  });

  it("success treats missing map key as inactive", () => {
    const map = new Map<string, boolean>();
    assert.deepEqual(filterVerifierDirectoryEntries(rows, "success", map), []);
  });

  it("failure keeps ponder-active rows", () => {
    const map = new Map<string, boolean>();
    const filtered = filterVerifierDirectoryEntries(rows, "failure", map);
    assert.equal(filtered.length, 2);
  });

  it("looks up addresses case-insensitively", () => {
    const mixed = [{ address: A.toUpperCase() as string, active: true, name: "a" }];
    const map = new Map<string, boolean>([[A.toLowerCase(), true]]);
    assert.equal(filterVerifierDirectoryEntries(mixed, "success", map).length, 1);
  });
});
