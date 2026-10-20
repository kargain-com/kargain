import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { verifierMembershipKey } from "../lib/kar-pro/is-active-verifier-commercial.ts";
import {
  filterVerifierDirectoryEntries,
  resolveEffectiveVerifierActive,
  showroomOpenFromMembership,
} from "../lib/verifier/effective-verifier.ts";

describe("resolveEffectiveVerifierActive", () => {
  it("success uses chain active (including inactive)", () => {
    assert.equal(resolveEffectiveVerifierActive("success", true, false), true);
    assert.equal(resolveEffectiveVerifierActive("success", false, true), false);
  });

  it("success with unread falls back to ponder", () => {
    assert.equal(resolveEffectiveVerifierActive("success", null, true), true);
    assert.equal(resolveEffectiveVerifierActive("success", null, false), false);
  });

  it("failure falls back to ponder active", () => {
    assert.equal(resolveEffectiveVerifierActive("failure", false, true), true);
    assert.equal(resolveEffectiveVerifierActive("failure", true, false), false);
    assert.equal(resolveEffectiveVerifierActive("failure", null, true), true);
  });
});

describe("showroomOpenFromMembership", () => {
  it("null membership + ponder inactive + no passports → closed", () => {
    assert.equal(showroomOpenFromMembership(null, false, 0), false);
  });

  it("null membership + ponder active → open", () => {
    assert.equal(showroomOpenFromMembership(null, true, 0), true);
  });

  it("known inactive wins over ponder active when no passports", () => {
    assert.equal(showroomOpenFromMembership(false, true, 0), false);
  });

  it("known active opens", () => {
    assert.equal(showroomOpenFromMembership(true, false, 0), true);
  });

  it("inactive + verifiedPassportTotal > 0 → open (6c5cebc parity)", () => {
    assert.equal(showroomOpenFromMembership(false, false, 1), true);
  });

  it("unread + ponder inactive + verifiedPassportTotal > 0 → open", () => {
    assert.equal(showroomOpenFromMembership(null, false, 2), true);
  });
});

describe("filterVerifierDirectoryEntries", () => {
  const A = "0xcFe194fea9727bD04dA8F78c2362680986e02dF1";
  const B = "0x1111111111111111111111111111111111111111";
  const HUB = 84532;
  const SPOKE = 11155111;

  const rows = [
    { address: A, chainId: HUB, active: true, name: "a-hub" },
    { address: A, chainId: SPOKE, active: true, name: "a-spoke" },
    { address: B, chainId: HUB, active: true, name: "b-hub" },
  ];

  it("success keeps only memberships active on their own chain", () => {
    const map = new Map<string, boolean>([
      [verifierMembershipKey(HUB, A), true],
      [verifierMembershipKey(SPOKE, A), false],
      [verifierMembershipKey(HUB, B), true],
    ]);
    const filtered = filterVerifierDirectoryEntries(rows, "success", map);
    assert.deepEqual(
      filtered.map((r) => r.name),
      ["a-hub", "b-hub"],
    );
  });

  it("success hides ponder-active when chain inactive for that membership", () => {
    const map = new Map<string, boolean>([
      [verifierMembershipKey(HUB, A), false],
      [verifierMembershipKey(SPOKE, A), false],
      [verifierMembershipKey(HUB, B), false],
    ]);
    assert.deepEqual(filterVerifierDirectoryEntries(rows, "success", map), []);
  });

  it("success treats missing map key as unread (ponder fallback)", () => {
    const map = new Map<string, boolean>();
    const filtered = filterVerifierDirectoryEntries(rows, "success", map);
    assert.deepEqual(
      filtered.map((r) => r.name),
      ["a-hub", "a-spoke", "b-hub"],
    );
  });

  it("failure keeps ponder-active rows", () => {
    const map = new Map<string, boolean>();
    const filtered = filterVerifierDirectoryEntries(rows, "failure", map);
    assert.equal(filtered.length, 3);
  });

  it("looks up addresses case-insensitively within membership key", () => {
    const mixed = [
      { address: A.toUpperCase() as string, chainId: HUB, active: true, name: "a" },
    ];
    const map = new Map<string, boolean>([[verifierMembershipKey(HUB, A), true]]);
    assert.equal(filterVerifierDirectoryEntries(mixed, "success", map).length, 1);
  });
});
