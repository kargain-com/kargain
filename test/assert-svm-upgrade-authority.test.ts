import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertSvmUpgradeAuthority,
  formatSvmAuthorityFailure,
  parseProgramShowAuthority,
} from "../scripts/lib/assert-svm-upgrade-authority.ts";
import type { SvmDevnetEvidence } from "../scripts/lib/load-deployment.ts";

function baseEvidence(
  overrides: Partial<SvmDevnetEvidence> = {},
): SvmDevnetEvidence {
  return {
    cluster: "solana-devnet",
    eid: 40168,
    namespace: 40168,
    programs: {
      kar_passport: {
        programId: "Pass111111111111111111111111111111111111111",
        upgradeAuthority: "Auth111111111111111111111111111111111111111",
      },
      kar_gateway: {
        programId: "Gate111111111111111111111111111111111111111",
        upgradeAuthority: "Auth111111111111111111111111111111111111111",
      },
    },
    ...overrides,
  };
}

describe("parseProgramShowAuthority", () => {
  it("reads Authority line", () => {
    const out = [
      "Program Id: FsDmjkrStitUPbh46y8JocGozNotF3EcT9rpDM1RDx1i",
      "Owner: BPFLoaderUpgradeab1e11111111111111111111111",
      "ProgramData Address: …",
      "Authority: BSuJ2aG3nxPyMnP2hxzkBTYc71k2R9Sf87PcnrzAXDaG",
      "Last Deployed In Slot: 1",
    ].join("\n");
    assert.equal(
      parseProgramShowAuthority(out),
      "BSuJ2aG3nxPyMnP2hxzkBTYc71k2R9Sf87PcnrzAXDaG",
    );
  });

  it("returns null for disabled / missing", () => {
    assert.equal(parseProgramShowAuthority("Authority: disabled\n"), null);
    assert.equal(parseProgramShowAuthority("no authority here\n"), null);
  });
});

describe("assertSvmUpgradeAuthority", () => {
  it("passes when every live program matches", async () => {
    const evidence = baseEvidence();
    const result = await assertSvmUpgradeAuthority(evidence, async (id) => {
      if (id.startsWith("Pass")) return "Auth111111111111111111111111111111111111111";
      if (id.startsWith("Gate")) return "Auth111111111111111111111111111111111111111";
      return null;
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.checked, 2);
  });

  it("refuses evidence ≠ chain", async () => {
    const evidence = baseEvidence();
    const result = await assertSvmUpgradeAuthority(evidence, async () => "OtherAuth");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.reasons.some((r) => r.includes("≠ on-chain")));
      assert.match(formatSvmAuthorityFailure(result), /refuse/);
    }
  });

  it("refuses missing per-program upgradeAuthority", async () => {
    const evidence = baseEvidence({
      programs: {
        kar_passport: { programId: "Pass111111111111111111111111111111111111111" },
        kar_gateway: {
          programId: "Gate111111111111111111111111111111111111111",
          upgradeAuthority: "Auth111111111111111111111111111111111111111",
        },
      },
    });
    const result = await assertSvmUpgradeAuthority(evidence, async () => "Auth");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.reasons.some((r) => r.includes("missing upgradeAuthority")));
    }
  });

  it("refuses plannedFinalUpgradeAuthority leftover", async () => {
    const evidence = baseEvidence({
      plannedFinalUpgradeAuthority: "BSuJ…",
    } as unknown as SvmDevnetEvidence);
    const result = await assertSvmUpgradeAuthority(
      evidence,
      async () => "Auth111111111111111111111111111111111111111",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(
        result.reasons.some((r) => r.includes("plannedFinalUpgradeAuthority")),
      );
    }
  });
});
