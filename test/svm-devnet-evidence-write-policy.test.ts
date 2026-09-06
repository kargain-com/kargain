/**
 * Sole SVM Devnet evidence write owner — additive merge + refuse-by-name.
 * Negative controls shown RED (thrown) then green (accepted merge).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { SvmDevnetEvidence } from "../lib/svm/devnet-evidence.ts";
import { commercialProgramCensusGapsFromEvidence } from "../lib/svm/ingest-config.ts";
import {
  assertRetainsPriorProgramKeys,
  mergeSvmDevnetEvidence,
  SvmDevnetEvidenceWriteError,
} from "../scripts/lib/svm-devnet-evidence-write.ts";
import { assertProgramShowAllowsUpgrade } from "../scripts/lib/svm-upgrade-in-place-assert.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function baselinePrior(): SvmDevnetEvidence {
  return {
    cluster: "solana-devnet",
    eid: 40168,
    namespace: 2000040168,
    programs: {
      kar_passport: {
        programId: "Passport111111111111111111111111111111111",
        deploySlot: 100,
        soSha256: "a".repeat(64),
        soBytes: 10,
      },
      kar_gateway: {
        programId: "Gateway111111111111111111111111111111111",
        deploySlot: 101,
        soSha256: "b".repeat(64),
        soBytes: 11,
      },
      kar_pro_staking: {
        programId: "Staking11111111111111111111111111111111",
        deploySlot: 102,
        soSha256: "c".repeat(64),
        soBytes: 12,
      },
      kar_pro_pass: {
        programId: "Pass11111111111111111111111111111111111",
        deploySlot: 103,
        soSha256: "d".repeat(64),
        soBytes: 13,
      },
      kar_fixed_price: {
        programId: "Fixed1111111111111111111111111111111111",
        deploySlot: 104,
        soSha256: "e".repeat(64),
        soBytes: 14,
      },
      kar_ascending: {
        programId: "Ascend111111111111111111111111111111111",
        deploySlot: 105,
        soSha256: "f".repeat(64),
        soBytes: 15,
      },
    },
    peers: {
      hubEid: 40245,
      spokeEid: 40168,
      hubOApp: "0x7324046854342587999984683c4833852FA81827",
      spokeOApp: "Spoke11111111111111111111111111111111111",
    },
    pathwayConfigHash:
      "0xc43a641bc5a50afc987fdc278f9bb1df64e5a1dfc5150b5d66233c1a376a7c98",
  };
}

describe("svm-devnet-evidence-write owner", () => {
  it("RED: merge that would drop an existing program key", () => {
    const prior = baselinePrior();
    const merged = mergeSvmDevnetEvidence({
      caller: "test-drop-ok",
      prior,
      programs: {},
    });
    assert.deepEqual(
      Object.keys(merged.programs).sort(),
      Object.keys(prior.programs).sort(),
    );

    assert.throws(
      () =>
        assertRetainsPriorProgramKeys(
          "test-drop",
          Object.keys(prior.programs),
          ["kar_passport", "kar_gateway"],
        ),
      (err: unknown) => {
        assert.ok(err instanceof SvmDevnetEvidenceWriteError);
        assert.equal(err.causeCode, "program_key_dropped");
        assert.match(err.message, /would drop existing program key/);
        return true;
      },
    );
  });

  it("RED then green: program row without soSha256", () => {
    const prior = baselinePrior();
    assert.throws(
      () =>
        mergeSvmDevnetEvidence({
          caller: "test-digest",
          prior,
          programs: {
            kar_passport: {
              programId: prior.programs.kar_passport.programId,
              soSha256: "",
              soBytes: 10,
            },
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof SvmDevnetEvidenceWriteError);
        assert.equal(err.causeCode, "missing_so_sha256");
        assert.match(err.message, /without soSha256/);
        return true;
      },
    );

    const ok = mergeSvmDevnetEvidence({
      caller: "test-digest",
      prior,
      programs: {
        kar_passport: {
          programId: prior.programs.kar_passport.programId,
          soSha256: "1".repeat(64),
          soBytes: 99,
        },
      },
    });
    assert.equal(ok.programs.kar_passport.soSha256, "1".repeat(64));
    assert.equal(ok.programs.kar_passport.soBytes, 99);
    assert.equal(ok.programs.kar_passport.deploySlot, 100);
  });

  it("RED then green: changing an existing deploySlot", () => {
    const prior = baselinePrior();
    assert.throws(
      () =>
        mergeSvmDevnetEvidence({
          caller: "test-slot",
          prior,
          programs: {
            kar_gateway: {
              programId: prior.programs.kar_gateway.programId,
              soSha256: "b".repeat(64),
              soBytes: 11,
              deploySlot: 999,
            },
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof SvmDevnetEvidenceWriteError);
        assert.equal(err.causeCode, "deploy_slot_immutable");
        assert.match(err.message, /deploySlot is immutable/);
        assert.match(err.message, /prior=101/);
        assert.match(err.message, /attempted=999/);
        return true;
      },
    );

    const ok = mergeSvmDevnetEvidence({
      caller: "test-slot",
      prior,
      programs: {
        kar_gateway: {
          programId: prior.programs.kar_gateway.programId,
          soSha256: "b".repeat(64),
          soBytes: 22,
          // deploySlot omitted — upgrade path
        },
      },
    });
    assert.equal(ok.programs.kar_gateway.deploySlot, 101);
    assert.equal(ok.programs.kar_gateway.soBytes, 22);
  });

  it("RED then green: evidence missing deploySlot for a commercial key (census)", () => {
    const prior = baselinePrior();
    const incomplete = {
      ...prior,
      programs: {
        ...prior.programs,
        kar_ascending: {
          programId: prior.programs.kar_ascending!.programId,
          soSha256: "f".repeat(64),
          soBytes: 15,
          // deploySlot absent
        },
      },
    };
    delete (incomplete.programs.kar_ascending as { deploySlot?: number }).deploySlot;

    const gaps = commercialProgramCensusGapsFromEvidence(incomplete);
    assert.ok(
      gaps.some(
        (g) => g.key === "kar_ascending" && g.cause === "missing_deploy_slot",
      ),
      `expected missing_deploy_slot for kar_ascending, got ${JSON.stringify(gaps)}`,
    );

    const completeGaps = commercialProgramCensusGapsFromEvidence(prior);
    assert.deepEqual(completeGaps, []);
  });

  it("preserves peers / pathwayConfigHash across program patch", () => {
    const prior = baselinePrior();
    const ok = mergeSvmDevnetEvidence({
      caller: "test-preserve",
      prior,
      programs: {
        kar_passport: {
          programId: prior.programs.kar_passport.programId,
          soSha256: "a".repeat(64),
          soBytes: 10,
        },
      },
    });
    assert.deepEqual(ok.peers, prior.peers);
    assert.equal(ok.pathwayConfigHash, prior.pathwayConfigHash);
  });

  it("RED: top-level field conflict", () => {
    const prior = baselinePrior();
    assert.throws(
      () =>
        mergeSvmDevnetEvidence({
          caller: "test-top",
          prior,
          topLevel: { namespace: 999 },
        }),
      (err: unknown) => {
        assert.ok(err instanceof SvmDevnetEvidenceWriteError);
        assert.equal(err.causeCode, "toplevel_conflict");
        assert.match(err.message, /namespace/);
        return true;
      },
    );
  });

  it("upgrade show parser: refuses non-upgradeable / wrong authority", () => {
    assert.throws(
      () =>
        assertProgramShowAllowsUpgrade({
          showText: "Owner: Tokenkeg...\nAuthority: Other",
          programId: "Prog",
          deployerPubkey: "Deployer",
          evidenceKey: "kar_passport",
        }),
      /not owned by the upgradeable loader/,
    );
    assert.throws(
      () =>
        assertProgramShowAllowsUpgrade({
          showText:
            "Owner: BPFLoaderUpgradeab1e11111111111111111111111\nAuthority: OtherPub",
          programId: "Prog",
          deployerPubkey: "Deployer",
          evidenceKey: "kar_passport",
        }),
      /upgrade authority ≠ deployer/,
    );
    assertProgramShowAllowsUpgrade({
      showText:
        "Owner: BPFLoaderUpgradeab1e11111111111111111111111\nAuthority: Deployer",
      programId: "Prog",
      deployerPubkey: "Deployer",
      evidenceKey: "kar_passport",
    });
  });

  it("scope: no inline evidence JSON writers remain in svm/scripts deploy shells", () => {
    const scripts = [
      "svm/scripts/deploy-devnet.sh",
      "svm/scripts/deploy-s5-staking.sh",
      "svm/scripts/deploy-s9-0-modes.sh",
    ];
    for (const rel of scripts) {
      const text = readFileSync(join(ROOT, rel), "utf8");
      assert.doesNotMatch(
        text,
        /json\.dumps|pathlib\.Path\(path\)\.write_text|writeSvmDevnetEvidence/,
        `${rel} must not write evidence itself`,
      );
      assert.match(
        text,
        /svm-upgrade-in-place|svm-merge-devnet-evidence/,
        `${rel} must call the write/upgrade owner`,
      );
    }
  });

  it("blank writeSvmDevnetEvidence is removed", async () => {
    const { writeSvmDevnetEvidence } = await import(
      "../scripts/lib/write-deployment.ts"
    );
    assert.throws(
      () => writeSvmDevnetEvidence("/tmp/x.json", baselinePrior()),
      /blank overwrite removed/,
    );
  });
});
