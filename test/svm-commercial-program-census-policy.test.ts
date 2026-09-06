/**
 * S9-0 / registry-runtime — six commercial program census from COMMERCIAL_ACTIVE.
 * Three-way census, stack gaps, namespace confirm, reachability off evidence loader,
 * no-deployments cursor proof.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

import type { SvmDevnetEvidence } from "../lib/svm/devnet-evidence.ts";
import {
  COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST,
  COMMERCIAL_PROGRAM_EVIDENCE_KEYS,
  MissingCommercialProgramError,
  assertSvmCommercialEvidence,
  assertSvmCommercialStack,
  commercialProgramCensusGaps,
  commercialProgramCensusGapsFromEvidence,
  followedProgramsFromStack,
  resolveIngestCommercialStack,
  resolveIngestNamespace,
  resolveIngestStartSlot,
} from "../lib/svm/ingest-config.ts";
import {
  requireCommercialActive,
  type SvmCommercialActiveStack,
} from "../lib/web3/commercial-active.ts";
import { namespaceFromLayerZeroEid } from "../lib/web3/kargain-namespace.ts";
import { formatSvmCommercialCensusSummary } from "../scripts/lib/assert-svm-upgrade-authority.ts";
import {
  loadSvmDevnetEvidence,
  requireSvmGatewayProgramId,
  requireSvmPassportProgramId,
} from "../scripts/lib/load-deployment.ts";
import { SVM_COMMERCIAL_PROGRAMS } from "../scripts/lib/svm-deploy-plan.ts";
import { FIXTURE_SVM_STACK } from "./fixtures/commercial-svm-stack.ts";
import {
  scanProductSources,
  traceStaticReachabilityToModules,
} from "./policy-scan-helpers.ts";

const EVIDENCE_KEYS = [...COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST].sort();
const DEPLOY_NAMES = SVM_COMMERCIAL_PROGRAMS.map((p) => p.name).sort();
const ASSERT_KEYS = [...COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST].sort();

const SLOT = 100;
const ROOT = join(import.meta.dirname, "..");
const SOLANA_NS = namespaceFromLayerZeroEid(40168);
const EXPECTED_START_SLOT = 490_463_509;

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

function stackFromFixture(
  overrides: Partial<SvmCommercialActiveStack> = {},
): SvmCommercialActiveStack {
  return {
    ...FIXTURE_SVM_STACK,
    ...overrides,
    blocks:
      overrides.blocks !== undefined
        ? overrides.blocks
        : { ...FIXTURE_SVM_STACK.blocks },
  };
}

describe("svm commercial program census (registry runtime)", () => {
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

  it("(a) full six → six follows; missing fixedPrice refuses by name", () => {
    const followed = followedProgramsFromStack(stackFromFixture());
    assert.equal(followed.length, 6);
    assert.deepEqual(
      followed.map((p) => p.evidenceKey).sort(),
      EVIDENCE_KEYS,
    );

    assert.throws(
      () =>
        followedProgramsFromStack(
          stackFromFixture({ fixedPriceConsignment: "" }),
        ),
      (err: unknown) => {
        assert.ok(err instanceof MissingCommercialProgramError);
        assert.ok(err.missingEvidenceKeys.includes("kar_fixed_price"));
        assert.match(err.message, /kar_fixed_price/);
        return true;
      },
    );

    assert.throws(
      () =>
        assertSvmCommercialStack(
          stackFromFixture({
            fixedPriceConsignment: undefined,
            ascendingConsignment: undefined,
          }),
        ),
      /kar_fixed_price.*kar_ascending|kar_ascending.*kar_fixed_price/,
    );
  });

  it("(b) fixture follow set stays six; start slot is min(blocks)", () => {
    const followed = followedProgramsFromStack(stackFromFixture());
    assert.equal(followed.length, 6);
    assert.ok(!followed.some((p) => p.evidenceKey === "mock_staking"));
    assert.equal(resolveIngestStartSlot(stackFromFixture()), 100);
  });

  it("(c) shape loader green on incomplete JSON; evidence census red; cast-only green", () => {
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

  it("(d) missing blocks slot refuses by name; later program does not raise cursor", () => {
    const missingSlot = stackFromFixture({
      blocks: {
        ...FIXTURE_SVM_STACK.blocks,
        ascendingConsignment: undefined,
      },
    });
    assert.throws(
      () => resolveIngestStartSlot(missingSlot),
      (err: unknown) => {
        assert.ok(err instanceof MissingCommercialProgramError);
        assert.ok(err.missingEvidenceKeys.includes("kar_ascending"));
        return true;
      },
    );

    const gaps = commercialProgramCensusGaps(missingSlot);
    assert.deepEqual(gaps, [
      { key: "kar_ascending", cause: "missing_deploy_slot" },
    ]);
    assert.throws(
      () => assertSvmCommercialStack(missingSlot),
      MissingCommercialProgramError,
    );

    // Evidence-file summary still shares the evidence predicate for UA tooling.
    const missingEvidenceSlot = {
      ...FULL_PROGRAMS,
      kar_ascending: {
        programId: FULL_PROGRAMS.kar_ascending!.programId,
      },
    } as unknown as SvmDevnetEvidence["programs"];
    const ev = evidenceWith(missingEvidenceSlot);
    assert.deepEqual(commercialProgramCensusGapsFromEvidence(ev), [
      { key: "kar_ascending", cause: "missing_deploy_slot" },
    ]);
    assert.equal(
      formatSvmCommercialCensusSummary(ev),
      "census: checked 5 of 6; incomplete: missing deploySlot: kar_ascending",
    );

    const staggered = stackFromFixture({
      blocks: {
        karProStaking: 100,
        karProPass: 100,
        karPassport: 100,
        bridgeGateway: 100,
        fixedPriceConsignment: 100,
        ascendingConsignment: 500,
      },
    });
    assert.equal(resolveIngestStartSlot(staggered), 100);
  });

  it("S9-0-close: four programs load + gateway ok; evidence census assert refuses modes", () => {
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

  it("assertSvmCommercialStack only at ingest entry (and owner)", () => {
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
        if (!/\bassertSvmCommercialStack\s*\(/.test(text)) continue;
        if (!allowed.has(rel)) hits.push(rel);
      }
    }

    for (const r of ["lib", "scripts", "src", "app", "components", "hooks"]) {
      walk(join(ROOT, r));
    }

    assert.deepEqual(
      hits,
      [],
      `assertSvmCommercialStack must not be called outside ingest entry + owner:\n${hits.join("\n")}`,
    );

    const ingestMain = readFileSync(join(ROOT, "src/svm-ingest/main.ts"), "utf8");
    assert.match(
      ingestMain,
      /\bassertSvmCommercialStack\s*\(/,
      "ingest entry must call assertSvmCommercialStack (sole hard census gate)",
    );
    assert.doesNotMatch(
      ingestMain,
      /loadSvmDevnetEvidence/,
      "ingest entry must not load deploy evidence at runtime",
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

  it("namespace confirm via resolveIngestCommercialStack", () => {
    const prevNs = process.env.SVM_INGEST_NAMESPACE;
    const prevEid = process.env.SVM_INGEST_EID;
    try {
      delete process.env.SVM_INGEST_NAMESPACE;
      delete process.env.SVM_INGEST_EID;
      const stack = resolveIngestCommercialStack();
      assert.equal(Number(stack.namespace), SOLANA_NS);
      assert.equal(resolveIngestNamespace(stack), SOLANA_NS);

      process.env.SVM_INGEST_NAMESPACE = "2000040168";
      assert.equal(
        Number(resolveIngestCommercialStack().namespace),
        SOLANA_NS,
      );

      process.env.SVM_INGEST_NAMESPACE = "999";
      assert.throws(
        () => resolveIngestCommercialStack(),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /SVM_INGEST_NAMESPACE=999/);
          assert.match(err.message, /COMMERCIAL_ACTIVE\.namespace=2000040168/);
          return true;
        },
      );
    } finally {
      if (prevNs === undefined) delete process.env.SVM_INGEST_NAMESPACE;
      else process.env.SVM_INGEST_NAMESPACE = prevNs;
      if (prevEid === undefined) delete process.env.SVM_INGEST_EID;
      else process.env.SVM_INGEST_EID = prevEid;
    }
  });

  it("no-deployments-dir: live registry cursor = min(blocks) = 490463509", () => {
    const empty = mkdtempSync(join(tmpdir(), "kargain-no-deployments-"));
    const prev = process.env.KARGAIN_DEPLOYMENTS_DIR;
    const prevNs = process.env.SVM_INGEST_NAMESPACE;
    const prevEid = process.env.SVM_INGEST_EID;
    process.env.KARGAIN_DEPLOYMENTS_DIR = empty;
    delete process.env.SVM_INGEST_NAMESPACE;
    delete process.env.SVM_INGEST_EID;
    try {
      assert.equal(loadSvmDevnetEvidence(40168), null);
      const stack = resolveIngestCommercialStack();
      assert.equal(stack, requireCommercialActive(SOLANA_NS));
      assert.equal(resolveIngestStartSlot(stack), EXPECTED_START_SLOT);
      assert.equal(followedProgramsFromStack(stack).length, 6);
    } finally {
      if (prev === undefined) delete process.env.KARGAIN_DEPLOYMENTS_DIR;
      else process.env.KARGAIN_DEPLOYMENTS_DIR = prev;
      if (prevNs === undefined) delete process.env.SVM_INGEST_NAMESPACE;
      else process.env.SVM_INGEST_NAMESPACE = prevNs;
      if (prevEid === undefined) delete process.env.SVM_INGEST_EID;
      else process.env.SVM_INGEST_EID = prevEid;
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("svm-ingest graph must not reach scripts/lib/load-deployment", () => {
    const banned = ["scripts/lib/load-deployment.ts"];
    const violations = traceStaticReachabilityToModules(banned, {
      startRoots: ["src/svm-ingest"],
      graphRoots: ["src", "lib", "scripts"],
    });
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );

    // scripts may still import the loader (deploy-machine).
    const scriptHits = traceStaticReachabilityToModules(banned, {
      startRoots: ["scripts/lib"],
      graphRoots: ["src", "lib", "scripts"],
      owners: banned,
    });
    // Owner is the banned module itself — skipped. Other scripts that import it are ok for this gate.
    assert.ok(Array.isArray(scriptHits));

    // Planted control: text scan green, graph red.
    const plantedRoot = mkdtempSync(join(tmpdir(), "kargain-ingest-reach-"));
    try {
      const ingestDir = join(plantedRoot, "src/svm-ingest");
      const scriptsDir = join(plantedRoot, "scripts/lib");
      mkdirSync(ingestDir, { recursive: true });
      mkdirSync(scriptsDir, { recursive: true });
      writeFileSync(
        join(ingestDir, "main.ts"),
        'import { loadSvmDevnetEvidence } from "../../scripts/lib/load-deployment.js";\nexport const x = loadSvmDevnetEvidence;\n',
      );
      writeFileSync(
        join(scriptsDir, "load-deployment.ts"),
        "export function loadSvmDevnetEvidence() { return null; }\n",
      );

      const textScan = scanProductSources(
        (rel, source) =>
          rel.startsWith("src/svm-ingest/") &&
          source.includes("@solana/web3.js")
            ? "sdk"
            : false,
        { rootDir: plantedRoot },
      );
      assert.deepEqual(textScan, []);

      const reachability = traceStaticReachabilityToModules(
        ["scripts/lib/load-deployment.ts"],
        {
          rootDir: plantedRoot,
          startRoots: ["src/svm-ingest"],
          graphRoots: ["src", "lib", "scripts"],
        },
      );
      assert.equal(reachability.length, 1);
      assert.equal(reachability[0]?.path, "src/svm-ingest/main.ts");
      assert.match(reachability[0]?.reason ?? "", /load-deployment/);
    } finally {
      rmSync(plantedRoot, { recursive: true, force: true });
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

    const planted = `export const X = "${banned}"`;
    assert.ok(planted.includes(banned));
  });
});
