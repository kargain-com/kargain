/**
 * S9-0 — six commercial program census: deploy plan ↔ ingest keys ↔ assert.
 * Bidirectional three-way + (a)(b)(c)(d) planted red→green controls.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { SvmDevnetEvidence } from "../lib/svm/devnet-evidence.ts";
import {
  COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST,
  COMMERCIAL_PROGRAM_EVIDENCE_KEYS,
  MissingCommercialProgramError,
  assertSvmCommercialEvidence,
  followedProgramsFromEvidence,
  resolveIngestStartSlot,
} from "../lib/svm/ingest-config.ts";
import { loadSvmDevnetEvidence } from "../scripts/lib/load-deployment.ts";
import { SVM_COMMERCIAL_PROGRAMS } from "../scripts/lib/svm-deploy-plan.ts";

const EVIDENCE_KEYS = [...COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST].sort();
const DEPLOY_NAMES = SVM_COMMERCIAL_PROGRAMS.map((p) => p.name).sort();
const ASSERT_KEYS = [...COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST].sort();

const SLOT = 100;

function withSlots(
  programs: Record<string, { programId: string; deploySlot?: number }>,
  slots?: Partial<Record<string, number>>,
): SvmDevnetEvidence["programs"] {
  const out = {} as SvmDevnetEvidence["programs"];
  for (const [key, row] of Object.entries(programs)) {
    (out as Record<string, { programId: string; deploySlot: number }>)[key] = {
      programId: row.programId,
      deploySlot: slots?.[key] ?? row.deploySlot ?? SLOT,
    };
  }
  return out;
}

function evidenceWith(
  programs: SvmDevnetEvidence["programs"],
): SvmDevnetEvidence {
  return {
    cluster: "solana-devnet",
    eid: 40168,
    namespace: 2_000_040_168,
    // Planted decoys — must never become the follow cursor.
    indexFromSlot: 999_999,
    slotAtEvidence: 888_888,
    programs,
  };
}

const FULL_PROGRAMS = withSlots({
  kar_passport: { programId: "Pass1111111111111111111111111111111111111" },
  kar_gateway: { programId: "Gate1111111111111111111111111111111111111" },
  kar_pro_staking: { programId: "Stak1111111111111111111111111111111111111" },
  kar_pro_pass: { programId: "ProP1111111111111111111111111111111111111" },
  kar_fixed_price: { programId: "Fixe1111111111111111111111111111111111111" },
  kar_ascending: { programId: "Asce1111111111111111111111111111111111111" },
});

describe("svm commercial program census (S9-0)", () => {
  it("three-way: deploy plan ≡ ingest keys ≡ assert keys; mock excluded", () => {
    assert.deepEqual(DEPLOY_NAMES, EVIDENCE_KEYS);
    assert.deepEqual(EVIDENCE_KEYS, ASSERT_KEYS);
    assert.deepEqual(DEPLOY_NAMES, ASSERT_KEYS);
    assert.equal(DEPLOY_NAMES.length, 6);
    assert.ok(!(DEPLOY_NAMES as string[]).includes("mock_staking"));
    assert.ok(!(EVIDENCE_KEYS as string[]).includes("mock_staking"));
    assert.ok(
      !(Object.values(COMMERCIAL_PROGRAM_EVIDENCE_KEYS) as string[]).includes(
        "mock_staking",
      ),
    );
  });

  it("(a) full six → six follows; missing kar_fixed_price refuses by name", () => {
    const followed = followedProgramsFromEvidence(evidenceWith(FULL_PROGRAMS));
    assert.equal(followed.length, 6);
    assert.deepEqual(
      followed.map((p) => p.evidenceKey).sort(),
      EVIDENCE_KEYS,
    );

    const withoutFixed = {
      ...FULL_PROGRAMS,
      kar_fixed_price: { programId: "", deploySlot: SLOT },
    };
    assert.throws(
      () => followedProgramsFromEvidence(evidenceWith(withoutFixed)),
      (err: unknown) => {
        assert.ok(err instanceof MissingCommercialProgramError);
        assert.ok(err.missingEvidenceKeys.includes("kar_fixed_price"));
        assert.match(err.message, /kar_fixed_price/);
        assert.match(err.message, /S9-0/);
        return true;
      },
    );

    const fourOnly = {
      kar_passport: FULL_PROGRAMS.kar_passport,
      kar_gateway: FULL_PROGRAMS.kar_gateway,
      kar_pro_staking: FULL_PROGRAMS.kar_pro_staking,
      kar_pro_pass: FULL_PROGRAMS.kar_pro_pass,
    } as unknown as SvmDevnetEvidence["programs"];
    assert.throws(
      () => assertSvmCommercialEvidence(evidenceWith(fourOnly)),
      /kar_fixed_price.*kar_ascending|kar_ascending.*kar_fixed_price/,
    );
  });

  it("(b) mock_staking present → follow set stays six; mock id absent", () => {
    const mockId = "Mock1111111111111111111111111111111111111";
    const withMock = evidenceWith({
      ...FULL_PROGRAMS,
      mock_staking: { programId: mockId, deploySlot: 50 },
    });
    const followed = followedProgramsFromEvidence(withMock);
    assert.equal(followed.length, 6);
    assert.ok(!followed.some((p) => p.programId === mockId));
    assert.ok(!followed.some((p) => p.evidenceKey === "mock_staking"));
    assert.equal(resolveIngestStartSlot(withMock), SLOT);
  });

  it("(c) product loader/assert red on incomplete JSON; planted cast-only green", () => {
    const incomplete = {
      cluster: "solana-devnet",
      eid: 40168,
      namespace: 2_000_040_168,
      programs: {
        kar_passport: FULL_PROGRAMS.kar_passport,
        kar_gateway: FULL_PROGRAMS.kar_gateway,
        kar_pro_staking: FULL_PROGRAMS.kar_pro_staking,
        kar_pro_pass: FULL_PROGRAMS.kar_pro_pass,
        // modes omitted — cast-only would still “type-check” at runtime
      },
    };
    const bytes = JSON.stringify(incomplete);

    // Planted cast-only: type assertion is not a check.
    const planted = JSON.parse(bytes) as SvmDevnetEvidence;
    assert.equal(typeof planted.programs.kar_gateway?.programId, "string");
    assert.equal(planted.programs.kar_fixed_price, undefined);

    assert.throws(
      () => assertSvmCommercialEvidence(planted),
      (err: unknown) => {
        assert.ok(err instanceof MissingCommercialProgramError);
        assert.ok(err.missingEvidenceKeys.includes("kar_fixed_price"));
        assert.ok(err.missingEvidenceKeys.includes("kar_ascending"));
        return true;
      },
    );

    const dir = mkdtempSync(join(tmpdir(), "s9-0-census-"));
    const prev = process.env.KARGAIN_DEPLOYMENTS_DIR;
    process.env.KARGAIN_DEPLOYMENTS_DIR = dir;
    try {
      writeFileSync(join(dir, "svm-40168.json"), bytes);
      assert.throws(
        () => loadSvmDevnetEvidence(40168),
        (err: unknown) => {
          assert.ok(err instanceof MissingCommercialProgramError);
          assert.match(err.message, /kar_fixed_price/);
          return true;
        },
      );
    } finally {
      if (prev === undefined) delete process.env.KARGAIN_DEPLOYMENTS_DIR;
      else process.env.KARGAIN_DEPLOYMENTS_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("(d) missing deploySlot refuses by name; later program does not raise cursor", () => {
    const missingSlot = {
      ...FULL_PROGRAMS,
      kar_ascending: {
        programId: FULL_PROGRAMS.kar_ascending.programId,
      },
    } as unknown as SvmDevnetEvidence["programs"];
    assert.throws(
      () => resolveIngestStartSlot(evidenceWith(missingSlot)),
      (err: unknown) => {
        assert.ok(err instanceof MissingCommercialProgramError);
        assert.ok(err.missingEvidenceKeys.includes("kar_ascending"));
        return true;
      },
    );

    const staggered = withSlots(
      {
        kar_passport: { programId: FULL_PROGRAMS.kar_passport.programId },
        kar_gateway: { programId: FULL_PROGRAMS.kar_gateway.programId },
        kar_pro_staking: { programId: FULL_PROGRAMS.kar_pro_staking.programId },
        kar_pro_pass: { programId: FULL_PROGRAMS.kar_pro_pass.programId },
        kar_fixed_price: { programId: FULL_PROGRAMS.kar_fixed_price.programId },
        kar_ascending: { programId: FULL_PROGRAMS.kar_ascending.programId },
      },
      {
        kar_passport: 100,
        kar_gateway: 100,
        kar_pro_staking: 100,
        kar_pro_pass: 100,
        kar_fixed_price: 100,
        kar_ascending: 500,
      },
    );
    const evidence = evidenceWith(staggered);
    assert.equal(resolveIngestStartSlot(evidence), 100);
    // Decoys must not win.
    assert.notEqual(resolveIngestStartSlot(evidence), evidence.indexFromSlot);
    assert.notEqual(resolveIngestStartSlot(evidence), evidence.slotAtEvidence);
  });
});
