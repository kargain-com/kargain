/**
 * S9-0 / S9-0-close — six commercial program census + loader layering.
 * Three-way census, (a)–(d), loader≠census, namespace truth, START_SLOT ban.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

import type { SvmDevnetEvidence } from "../lib/svm/devnet-evidence.ts";
import {
  COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST,
  COMMERCIAL_PROGRAM_EVIDENCE_KEYS,
  MissingCommercialProgramError,
  assertSvmCommercialEvidence,
  followedProgramsFromEvidence,
  resolveIngestNamespace,
  resolveIngestStartSlot,
} from "../lib/svm/ingest-config.ts";
import {
  loadSvmDevnetEvidence,
  requireSvmGatewayProgramId,
  requireSvmPassportProgramId,
} from "../scripts/lib/load-deployment.ts";
import { SVM_COMMERCIAL_PROGRAMS } from "../scripts/lib/svm-deploy-plan.ts";

const EVIDENCE_KEYS = [...COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST].sort();
const DEPLOY_NAMES = SVM_COMMERCIAL_PROGRAMS.map((p) => p.name).sort();
const ASSERT_KEYS = [...COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST].sort();

const SLOT = 100;
const ROOT = join(import.meta.dirname, "..");

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
  extra: Partial<SvmDevnetEvidence> = {},
): SvmDevnetEvidence {
  return {
    cluster: "solana-devnet",
    eid: 40168,
    namespace: 2_000_040_168,
    indexFromSlot: 999_999,
    slotAtEvidence: 888_888,
    programs,
    ...extra,
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

const FOUR_PROGRAMS = withSlots({
  kar_passport: { programId: "Pass1111111111111111111111111111111111111" },
  kar_gateway: { programId: "Gate1111111111111111111111111111111111111" },
  kar_pro_staking: { programId: "Stak1111111111111111111111111111111111111" },
  kar_pro_pass: { programId: "ProP1111111111111111111111111111111111111" },
});

describe("svm commercial program census (S9-0 / S9-0-close)", () => {
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

    assert.throws(
      () => assertSvmCommercialEvidence(evidenceWith(FOUR_PROGRAMS)),
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

  it("(c) shape loader green on incomplete JSON; commercial assert red; cast-only green", () => {
    const incomplete = {
      cluster: "solana-devnet",
      eid: 40168,
      namespace: 2_000_040_168,
      programs: {
        kar_passport: FULL_PROGRAMS.kar_passport,
        kar_gateway: FULL_PROGRAMS.kar_gateway,
        kar_pro_staking: FULL_PROGRAMS.kar_pro_staking,
        kar_pro_pass: FULL_PROGRAMS.kar_pro_pass,
      },
    };
    const bytes = JSON.stringify(incomplete);

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

    const dir = mkdtempSync(join(tmpdir(), "s9-0-close-"));
    const prev = process.env.KARGAIN_DEPLOYMENTS_DIR;
    process.env.KARGAIN_DEPLOYMENTS_DIR = dir;
    try {
      writeFileSync(join(dir, "svm-40168.json"), bytes);
      const loaded = loadSvmDevnetEvidence(40168);
      assert.ok(loaded);
      assert.equal(
        requireSvmGatewayProgramId(loaded),
        FULL_PROGRAMS.kar_gateway.programId,
      );
      assert.throws(
        () => assertSvmCommercialEvidence(loaded),
        /kar_fixed_price/,
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
        programId: FULL_PROGRAMS.kar_ascending!.programId,
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
        kar_pro_staking: { programId: FULL_PROGRAMS.kar_pro_staking!.programId },
        kar_pro_pass: { programId: FULL_PROGRAMS.kar_pro_pass!.programId },
        kar_fixed_price: { programId: FULL_PROGRAMS.kar_fixed_price!.programId },
        kar_ascending: { programId: FULL_PROGRAMS.kar_ascending!.programId },
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
    assert.notEqual(resolveIngestStartSlot(evidence), evidence.indexFromSlot);
    assert.notEqual(resolveIngestStartSlot(evidence), evidence.slotAtEvidence);
  });

  it("S9-0-close: four programs load + gateway ok; census assert refuses modes", () => {
    const four = evidenceWith(FOUR_PROGRAMS);
    assert.equal(
      requireSvmGatewayProgramId(four),
      FOUR_PROGRAMS.kar_gateway.programId,
    );
    assert.equal(
      requireSvmPassportProgramId(four),
      FOUR_PROGRAMS.kar_passport.programId,
    );
    assert.throws(
      () => assertSvmCommercialEvidence(four),
      (err: unknown) => {
        assert.ok(err instanceof MissingCommercialProgramError);
        assert.ok(err.missingEvidenceKeys.includes("kar_fixed_price"));
        assert.ok(err.missingEvidenceKeys.includes("kar_ascending"));
        return true;
      },
    );
  });

  it("S9-0-close-2: assertSvmCommercialEvidence only at ingest entry (and owner)", () => {
    const needle = "assertSvmCommercialEvidence(";
    const allowed = new Set([
      "lib/svm/ingest-config.ts",
      "src/svm-ingest/main.ts",
    ]);
    const hits: string[] = [];

    function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        if (
          name === "node_modules" ||
          name === "target" ||
          name === ".git" ||
          name === "test"
        ) {
          continue;
        }
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const rel = relative(ROOT, p);
        const text = readFileSync(p, "utf8");
        if (!/\bassertSvmCommercialEvidence\s*\(/.test(text)) continue;
        if (!allowed.has(rel)) hits.push(rel);
      }
    }

    for (const r of ["lib", "scripts", "src", "app", "components", "hooks"]) {
      walk(join(ROOT, r));
    }

    assert.deepEqual(
      hits,
      [],
      `assertSvmCommercialEvidence must not be called outside ingest entry + owner:\n${hits.join("\n")}`,
    );

    const ingestMain = readFileSync(join(ROOT, "src/svm-ingest/main.ts"), "utf8");
    assert.match(
      ingestMain,
      /\bassertSvmCommercialEvidence\s*\(/,
      "ingest entry must call assertSvmCommercialEvidence (sole hard census gate)",
    );

    assert.ok(
      !readFileSync(
        join(ROOT, "scripts/assert-svm-upgrade-authority.ts"),
        "utf8",
      ).includes(needle),
    );
  });

  it("S9-0-close: missing kar_gateway refuses by name", () => {
    const noGate = evidenceWith({
      kar_passport: FULL_PROGRAMS.kar_passport,
      kar_gateway: { programId: "" },
    } as SvmDevnetEvidence["programs"]);
    assert.throws(
      () => requireSvmGatewayProgramId(noGate),
      /kar_gateway/,
    );
  });

  it("S9-0-close: namespace confirm / fill / mismatch", () => {
    const prev = process.env.SVM_INGEST_NAMESPACE;
    try {
      process.env.SVM_INGEST_NAMESPACE = "2000040168";
      assert.equal(
        resolveIngestNamespace(evidenceWith(FULL_PROGRAMS)),
        2_000_040_168,
      );

      process.env.SVM_INGEST_NAMESPACE = "999";
      assert.throws(
        () => resolveIngestNamespace(evidenceWith(FULL_PROGRAMS)),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /SVM_INGEST_NAMESPACE=999/);
          assert.match(err.message, /evidence\.namespace=2000040168/);
          return true;
        },
      );

      delete process.env.SVM_INGEST_NAMESPACE;
      assert.equal(
        resolveIngestNamespace(evidenceWith(FULL_PROGRAMS)),
        2_000_040_168,
      );

      process.env.SVM_INGEST_NAMESPACE = "42";
      const evidenceNoNs = {
        cluster: "solana-devnet",
        eid: 40168,
        programs: FULL_PROGRAMS,
      } as SvmDevnetEvidence;
      assert.equal(resolveIngestNamespace(evidenceNoNs), 42);

      delete process.env.SVM_INGEST_NAMESPACE;
      assert.throws(() => resolveIngestNamespace(evidenceNoNs), /unset/);
    } finally {
      if (prev === undefined) delete process.env.SVM_INGEST_NAMESPACE;
      else process.env.SVM_INGEST_NAMESPACE = prev;
    }
  });

  it("S9-0-close: retired ingest start-slot env appears nowhere in operational surfaces", () => {
    const banned = ["SVM_INGEST", "START_SLOT"].join("_");
    const roots = [
      "lib",
      "scripts",
      "src",
      "app",
      "components",
      "hooks",
      "docs/indexer",
    ];
    const rootFiles = ["docker-compose.yml", ".env.example", "package.json"];
    const hits: string[] = [];
    const selfRel = "test/svm-commercial-program-census-policy.test.ts";

    function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "target" || name === ".git") continue;
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if (
          /\.(ts|tsx|js|mjs|cjs|md|yml|yaml|example|json)$/.test(name) ||
          name === "Dockerfile.svm-ingest"
        ) {
          const rel = relative(ROOT, p);
          if (rel === selfRel) continue;
          const text = readFileSync(p, "utf8");
          if (text.includes(banned)) hits.push(rel);
        }
      }
    }

    for (const r of roots) walk(join(ROOT, r));
    for (const f of rootFiles) {
      const p = join(ROOT, f);
      try {
        if (readFileSync(p, "utf8").includes(banned)) hits.push(f);
      } catch {
        /* missing */
      }
    }

    assert.deepEqual(
      hits,
      [],
      `Retired ${banned} must not appear:\n${hits.join("\n")}`,
    );

    // Planted control: reconstructing the retired name is detectable.
    const planted = `export const X = "${banned}"`;
    assert.ok(planted.includes(banned));
  });
});
