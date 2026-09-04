import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertSvmUpgradeAuthority,
  formatSvmAuthorityFailure,
  formatSvmAuthoritySuccessLines,
  formatSvmCommercialCensusSummary,
  parseProgramShowAuthority,
} from "../scripts/lib/assert-svm-upgrade-authority.ts";
import type { SvmDevnetEvidence } from "../scripts/lib/load-deployment.ts";
import {
  MissingCommercialProgramError,
  assertSvmCommercialEvidence,
} from "../lib/svm/ingest-config.ts";

const AUTH = "Auth111111111111111111111111111111111111111";
const OTHER = "OtherAuth111111111111111111111111111111111";

const FULL_PROGRAMS: SvmDevnetEvidence["programs"] = {
  kar_passport: {
    programId: "Pass111111111111111111111111111111111111111",
    deploySlot: 100,
    upgradeAuthority: AUTH,
  },
  kar_gateway: {
    programId: "Gate111111111111111111111111111111111111111",
    deploySlot: 100,
    upgradeAuthority: AUTH,
  },
  kar_pro_staking: {
    programId: "Stak111111111111111111111111111111111111111",
    deploySlot: 100,
    upgradeAuthority: AUTH,
  },
  kar_pro_pass: {
    programId: "Ppas111111111111111111111111111111111111111",
    deploySlot: 100,
    upgradeAuthority: AUTH,
  },
  kar_fixed_price: {
    programId: "Fixe1111111111111111111111111111111111111",
    deploySlot: 100,
    upgradeAuthority: AUTH,
  },
  kar_ascending: {
    programId: "Asce111111111111111111111111111111111111111",
    deploySlot: 100,
    upgradeAuthority: AUTH,
  },
};

const FOUR_PROGRAMS: SvmDevnetEvidence["programs"] = {
  kar_passport: FULL_PROGRAMS.kar_passport,
  kar_gateway: FULL_PROGRAMS.kar_gateway,
  kar_pro_staking: FULL_PROGRAMS.kar_pro_staking,
  kar_pro_pass: FULL_PROGRAMS.kar_pro_pass,
};

function baseEvidence(
  overrides: Partial<SvmDevnetEvidence> = {},
): SvmDevnetEvidence {
  return {
    cluster: "solana-devnet",
    eid: 40168,
    namespace: 40168,
    programs: { ...FULL_PROGRAMS },
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

describe("assertSvmUpgradeAuthority (S9-0-close-2)", () => {
  it("four live programs matching → exit-path green; census incomplete names modes", async () => {
    const evidence = baseEvidence({ programs: { ...FOUR_PROGRAMS } });
    const result = await assertSvmUpgradeAuthority(evidence, async () => AUTH);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.checked, 4);
    assert.equal(result.standOnlyChecked, 0);
    assert.equal(
      formatSvmCommercialCensusSummary(evidence),
      "census: checked 4 of 6; incomplete: missing programId: kar_ascending, kar_fixed_price",
    );
    const lines = formatSvmAuthoritySuccessLines(result, evidence);
    assert.deepEqual(lines, [
      "  OK 4 program(s) evidence ≡ on-chain Authority",
      "  census: checked 4 of 6; incomplete: missing programId: kar_ascending, kar_fixed_price",
    ]);
  });

  it("six programIds with one missing deploySlot → summary not complete; gate refuses", async () => {
    const evidence = baseEvidence({
      programs: {
        ...FULL_PROGRAMS,
        kar_ascending: {
          programId: FULL_PROGRAMS.kar_ascending!.programId,
          upgradeAuthority: AUTH,
          // deploySlot omitted
        },
      },
    });
    const summary = formatSvmCommercialCensusSummary(evidence);
    assert.equal(
      summary,
      "census: checked 5 of 6; incomplete: missing deploySlot: kar_ascending",
    );
    assert.ok(!summary.endsWith("; complete"));
    assert.throws(
      () => assertSvmCommercialEvidence(evidence),
      (err: unknown) => {
        assert.ok(err instanceof MissingCommercialProgramError);
        assert.deepEqual([...err.missingEvidenceKeys], ["kar_ascending"]);
        return true;
      },
    );
    // Authority can still be green — census summary is separate from UA refuse.
    const result = await assertSvmUpgradeAuthority(evidence, async () => AUTH);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.checked, 6);
  });

  it("four programs with one authority mismatched → refuse naming program and both authorities", async () => {
    const evidence = baseEvidence({
      programs: {
        ...FOUR_PROGRAMS,
        kar_gateway: {
          ...FOUR_PROGRAMS.kar_gateway!,
          upgradeAuthority: AUTH,
        },
      },
    });
    const result = await assertSvmUpgradeAuthority(evidence, async (id) => {
      if (id.startsWith("Gate")) return OTHER;
      return AUTH;
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      const row = result.reasons.find((r) => r.includes("kar_gateway"));
      assert.ok(row);
      assert.match(row!, new RegExp(AUTH));
      assert.match(row!, new RegExp(OTHER));
      assert.match(row!, /≠ on-chain/);
    }
  });

  it("all six present with one mismatched → refuse", async () => {
    const evidence = baseEvidence();
    const result = await assertSvmUpgradeAuthority(evidence, async (id) => {
      if (id.startsWith("Asce")) return OTHER;
      return AUTH;
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.reasons.some((r) => r.includes("kar_ascending")));
    }
  });

  it("passes when every live program matches (six)", async () => {
    const evidence = baseEvidence();
    const result = await assertSvmUpgradeAuthority(evidence, async () => AUTH);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.checked, 6);
      assert.equal(result.standOnlyChecked, 0);
    }
    assert.equal(
      formatSvmCommercialCensusSummary(evidence),
      "census: checked 6 of 6; complete",
    );
  });

  it("verifies mock_staking as stand-only outside the six-count", async () => {
    const evidence = baseEvidence({
      programs: {
        ...FOUR_PROGRAMS,
        mock_staking: {
          programId: "Mock1111111111111111111111111111111111111",
          upgradeAuthority: AUTH,
        },
      },
    });
    const result = await assertSvmUpgradeAuthority(evidence, async () => AUTH);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.checked, 4);
    assert.equal(result.standOnlyChecked, 1);
    const lines = formatSvmAuthoritySuccessLines(result, evidence);
    assert.ok(lines.some((l) => l.includes("stand-only mock_staking")));
    assert.match(
      formatSvmCommercialCensusSummary(evidence),
      /checked 4 of 6; incomplete/,
    );
  });

  it("refuses evidence ≠ chain", async () => {
    const evidence = baseEvidence();
    const result = await assertSvmUpgradeAuthority(evidence, async () => OTHER);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.reasons.some((r) => r.includes("≠ on-chain")));
      assert.match(formatSvmAuthorityFailure(result), /refuse/);
    }
  });

  it("refuses missing per-program upgradeAuthority", async () => {
    const evidence = baseEvidence({
      programs: {
        ...FULL_PROGRAMS,
        kar_passport: {
          programId: "Pass111111111111111111111111111111111111111",
          deploySlot: 100,
        },
      },
    });
    const result = await assertSvmUpgradeAuthority(evidence, async () => AUTH);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.reasons.some((r) => r.includes("missing upgradeAuthority")));
    }
  });

  it("refuses plannedFinalUpgradeAuthority leftover", async () => {
    const evidence = baseEvidence({
      plannedFinalUpgradeAuthority: "BSuJ…",
    } as unknown as SvmDevnetEvidence);
    const result = await assertSvmUpgradeAuthority(evidence, async () => AUTH);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(
        result.reasons.some((r) => r.includes("plannedFinalUpgradeAuthority")),
      );
    }
  });
});
