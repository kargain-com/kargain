/**
 * Sole SVM Devnet evidence write owner — additive merge + refuse-by-name.
 * Negative controls shown RED (thrown) then green (accepted merge).
 * Writer scope is a property scan over scripts/ + svm/scripts/ (not a path allowlist).
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { SvmDevnetEvidence } from "../lib/svm/devnet-evidence.ts";
import { commercialProgramCensusGapsFromEvidence } from "../lib/svm/ingest-config.ts";
import {
  assertRetainsPriorProgramKeys,
  mergeAndWriteSvmDevnetEvidence,
  mergeSvmDevnetEvidence,
  SvmDevnetEvidenceWriteError,
  writeSvmBridgePathwayEvidence,
  writeSvmY4ProveEvidence,
} from "../scripts/lib/svm-devnet-evidence-write.ts";
import { assertProgramShowAllowsUpgrade } from "../scripts/lib/svm-upgrade-in-place-assert.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_REL = "scripts/lib/svm-devnet-evidence-write.ts";
const EVIDENCE_SCAN_ROOTS = ["scripts", "svm/scripts"] as const;
const SCAN_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".sh",
  ".bash",
  ".py",
]);

function baselinePrior(): SvmDevnetEvidence {
  const head = "a".repeat(40);
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
        sourceGitHead: head,
      },
      kar_gateway: {
        programId: "Gateway111111111111111111111111111111111",
        deploySlot: 101,
        soSha256: "b".repeat(64),
        soBytes: 11,
        sourceGitHead: head,
      },
      kar_pro_staking: {
        programId: "Staking11111111111111111111111111111111",
        deploySlot: 102,
        soSha256: "c".repeat(64),
        soBytes: 12,
        sourceGitHead: head,
      },
      kar_pro_pass: {
        programId: "Pass11111111111111111111111111111111111",
        deploySlot: 103,
        soSha256: "d".repeat(64),
        soBytes: 13,
        sourceGitHead: head,
      },
      kar_fixed_price: {
        programId: "Fixed1111111111111111111111111111111111",
        deploySlot: 104,
        soSha256: "e".repeat(64),
        soBytes: 14,
        sourceGitHead: head,
      },
      kar_ascending: {
        programId: "Ascend111111111111111111111111111111111",
        deploySlot: 105,
        soSha256: "f".repeat(64),
        soBytes: 15,
        sourceGitHead: head,
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

function patchWithSource(
  prior: SvmDevnetEvidence,
  key: keyof SvmDevnetEvidence["programs"],
  overrides: Partial<{
    programId: string;
    soSha256: string;
    soBytes: number;
    sourceGitHead: string;
    deploySlot: number;
  }> = {},
) {
  const row = prior.programs[key]!;
  return {
    programId: overrides.programId ?? row.programId,
    soSha256: overrides.soSha256 ?? row.soSha256!,
    soBytes: overrides.soBytes ?? row.soBytes!,
    sourceGitHead: overrides.sourceGitHead ?? row.sourceGitHead!,
    ...(overrides.deploySlot !== undefined
      ? { deploySlot: overrides.deploySlot }
      : {}),
  };
}

/** Property scan — any evidence-document write outside the sole owner. */
export function findSvmEvidenceWriteViolations(
  rootDir: string,
): { path: string; reason: string }[] {
  const hits: { path: string; reason: string }[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "node_modules" || name === ".next" || name === "target") {
        continue;
      }
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = name.includes(".") ? `.${name.split(".").pop()}` : "";
      if (!SCAN_EXTENSIONS.has(ext)) continue;
      const rel = relative(rootDir, full).split("\\").join("/");
      if (rel === OWNER_REL) continue;
      const source = readFileSync(full, "utf8");
      const reason = classifyEvidenceWriteViolation(source);
      if (reason) hits.push({ path: rel, reason });
    }
  }

  for (const root of EVIDENCE_SCAN_ROOTS) {
    walk(join(rootDir, root));
  }
  return hits;
}

function classifyEvidenceWriteViolation(source: string): string | false {
  if (/\bwriteSvmDevnetEvidence\b/.test(source)) {
    return "retired blank writer writeSvmDevnetEvidence";
  }
  if (
    /\bwriteFileSync\b/.test(source) &&
    /deployments\/svm-|svmDevnetEvidencePath|svm-\d+\.json/.test(source)
  ) {
    return "direct writeFileSync of svm evidence document";
  }
  if (
    /\bwriteFile\b\s*\(/.test(source) &&
    /deployments\/svm-|svm-\d+\.json/.test(source)
  ) {
    return "direct writeFile of svm evidence document";
  }
  if (/>>?\s*[^\n#]*deployments\/svm-\d+\.json/.test(source)) {
    return "shell redirection into svm evidence json under deployments";
  }
  if (
    /pathlib\.Path\([^)]*\)\.write_text/.test(source) &&
    /svm-|programs|evidence/.test(source)
  ) {
    return "python pathlib write of evidence";
  }
  if (
    /json\.dumps/.test(source) &&
    /Path\([^)]*\)\.write_text|open\([^)]*[\"']w/.test(source)
  ) {
    return "python json.dumps evidence writer";
  }
  return false;
}

describe("svm-devnet-evidence-write owner", () => {
  it("RED then green: merge that would drop an existing program key", () => {
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

  it("RED then green: program row with digest but no sourceGitHead", () => {
    const prior = baselinePrior();
    assert.throws(
      () =>
        mergeSvmDevnetEvidence({
          caller: "test-source",
          prior,
          programs: {
            kar_passport: {
              programId: prior.programs.kar_passport.programId,
              soSha256: "1".repeat(64),
              soBytes: 10,
              sourceGitHead: "",
            },
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof SvmDevnetEvidenceWriteError);
        assert.equal(err.causeCode, "missing_source_git_head");
        assert.match(err.message, /has digest but no sourceGitHead/);
        return true;
      },
    );

    const ok = mergeSvmDevnetEvidence({
      caller: "test-source",
      prior,
      programs: {
        kar_passport: patchWithSource(prior, "kar_passport", {
          soSha256: "1".repeat(64),
          soBytes: 99,
          sourceGitHead: "b".repeat(40),
        }),
      },
    });
    assert.equal(ok.programs.kar_passport.sourceGitHead, "b".repeat(40));
    assert.equal(ok.programs.kar_passport.soBytes, 99);
    assert.equal(ok.deployGitHead, undefined);
  });

  it("RED then green: identity-field change", () => {
    const prior = baselinePrior();
    assert.throws(
      () =>
        mergeSvmDevnetEvidence({
          caller: "test-identity",
          prior,
          identity: { namespace: 999 },
        }),
      (err: unknown) => {
        assert.ok(err instanceof SvmDevnetEvidenceWriteError);
        assert.equal(err.causeCode, "identity_conflict");
        assert.match(err.message, /identity "namespace" conflict/);
        assert.match(err.message, /prior=2000040168/);
        assert.match(err.message, /attempted=999/);
        return true;
      },
    );

    const ok = mergeSvmDevnetEvidence({
      caller: "test-identity",
      prior,
      identity: { namespace: 2000040168 },
    });
    assert.equal(ok.namespace, 2000040168);
  });

  it("RED then green: annotation-field change without explicit annotations argument", () => {
    const prior = baselinePrior();
    const nextPeers = {
      hubEid: 40245 as const,
      spokeEid: 40168 as const,
      hubOApp: "0x1111111111111111111111111111111111111111" as `0x${string}`,
      spokeOApp: "NewSpoke111111111111111111111111111111111",
    };
    assert.throws(
      () =>
        mergeSvmDevnetEvidence({
          caller: "test-ann-channel",
          prior,
          identity: { peers: nextPeers } as never,
        }),
      (err: unknown) => {
        assert.ok(err instanceof SvmDevnetEvidenceWriteError);
        assert.equal(err.causeCode, "annotation_requires_explicit_argument");
        assert.match(err.message, /annotation "peers" requires explicit/);
        assert.match(err.message, /prior=/);
        assert.match(err.message, /attempted=/);
        return true;
      },
    );

    const ok = mergeSvmDevnetEvidence({
      caller: "test-ann-channel",
      prior,
      annotations: { peers: nextPeers },
    });
    assert.deepEqual(ok.peers, nextPeers);
  });

  it("RED then green: programId change on an existing key", () => {
    const prior = baselinePrior();
    assert.throws(
      () =>
        mergeSvmDevnetEvidence({
          caller: "test-pid",
          prior,
          programs: {
            kar_gateway: patchWithSource(prior, "kar_gateway", {
              programId: "DifferentGateway11111111111111111111111",
            }),
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof SvmDevnetEvidenceWriteError);
        assert.equal(err.causeCode, "program_id_immutable");
        assert.match(err.message, /programId is immutable/);
        assert.match(err.message, /prior=Gateway111/);
        assert.match(err.message, /attempted=DifferentGateway/);
        return true;
      },
    );

    const ok = mergeSvmDevnetEvidence({
      caller: "test-pid",
      prior,
      programs: {
        kar_gateway: patchWithSource(prior, "kar_gateway", { soBytes: 22 }),
      },
    });
    assert.equal(ok.programs.kar_gateway.programId, prior.programs.kar_gateway.programId);
    assert.equal(ok.programs.kar_gateway.soBytes, 22);
  });

  it("RED then green: changing an existing deploySlot", () => {
    const prior = baselinePrior();
    assert.throws(
      () =>
        mergeSvmDevnetEvidence({
          caller: "test-slot",
          prior,
          programs: {
            kar_gateway: patchWithSource(prior, "kar_gateway", {
              deploySlot: 999,
            }),
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
        kar_gateway: patchWithSource(prior, "kar_gateway", { soBytes: 22 }),
      },
    });
    assert.equal(ok.programs.kar_gateway.deploySlot, 101);
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
          sourceGitHead: "a".repeat(40),
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

  it("strips retired document-level deployGitHead", () => {
    const prior = {
      ...baselinePrior(),
      deployGitHead: "oldocumenthead000000000000000000000000",
    };
    const ok = mergeSvmDevnetEvidence({
      caller: "test-strip-head",
      prior,
    });
    assert.equal(ok.deployGitHead, undefined);
    assert.equal(ok.programs.kar_passport.sourceGitHead, "a".repeat(40));
  });

  it("preserves peers / pathwayConfigHash across program patch", () => {
    const prior = baselinePrior();
    const ok = mergeSvmDevnetEvidence({
      caller: "test-preserve",
      prior,
      programs: {
        kar_passport: patchWithSource(prior, "kar_passport"),
      },
    });
    assert.deepEqual(ok.peers, prior.peers);
    assert.equal(ok.pathwayConfigHash, prior.pathwayConfigHash);
  });

  it("executes bridge-wire pathway write against synthetic prior", () => {
    const prior = baselinePrior();
    const dir = mkdtempSync(join(tmpdir(), "kargain-bridge-ev-"));
    const path = join(dir, "svm-40168.json");
    try {
      const nextPeers = {
        hubEid: 40245 as const,
        spokeEid: 40168 as const,
        hubOApp: "0x2222222222222222222222222222222222222222" as `0x${string}`,
        spokeOApp: "BridgeSpoke111111111111111111111111111111",
      };
      const hash =
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;
      const written = writeSvmBridgePathwayEvidence({
        path,
        prior,
        peers: nextPeers,
        pathwayConfigHash: hash,
        oapp: nextPeers.spokeOApp,
        note: "test bridge pathway write",
      });
      assert.deepEqual(written.peers, nextPeers);
      assert.equal(written.pathwayConfigHash, hash);
      assert.equal(written.oapp, nextPeers.spokeOApp);
      assert.equal(written.programs.kar_passport.programId, prior.programs.kar_passport.programId);
      const disk = JSON.parse(readFileSync(path, "utf8")) as SvmDevnetEvidence;
      assert.deepEqual(disk.peers, nextPeers);
      assert.equal(disk.pathwayConfigHash, hash);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("executes y4-prove annotation write against synthetic prior", () => {
    const prior = baselinePrior();
    const dir = mkdtempSync(join(tmpdir(), "kargain-y4-ev-"));
    const path = join(dir, "svm-40168.json");
    try {
      const y4 = {
        at: "2026-09-06T00:00:00.000Z",
        registeredOApp: true,
        hubStillUnwired: true,
      };
      const written = writeSvmY4ProveEvidence({ path, prior, y4 });
      assert.deepEqual(written.y4, y4);
      assert.deepEqual(written.peers, prior.peers);
      const disk = JSON.parse(readFileSync(path, "utf8")) as SvmDevnetEvidence;
      assert.deepEqual(disk.y4, y4);
      assert.equal(disk.programs.kar_gateway.deploySlot, 101);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mergeAndWrite persists additive merge (filesystem owner path)", () => {
    const prior = baselinePrior();
    const dir = mkdtempSync(join(tmpdir(), "kargain-merge-ev-"));
    const path = join(dir, "svm-40168.json");
    try {
      mergeAndWriteSvmDevnetEvidence(path, {
        caller: "test-fs",
        prior,
        annotations: { slotAtEvidence: 424242 },
        programs: {
          kar_passport: patchWithSource(prior, "kar_passport", { soBytes: 77 }),
        },
      });
      const disk = JSON.parse(readFileSync(path, "utf8")) as SvmDevnetEvidence;
      assert.equal(disk.slotAtEvidence, 424242);
      assert.equal(disk.programs.kar_passport.soBytes, 77);
      assert.equal(disk.programs.kar_ascending?.deploySlot, 105);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it("property scan: sole owner writes evidence; planted non-shell writer is RED", () => {
    const live = findSvmEvidenceWriteViolations(ROOT);
    assert.deepEqual(
      live,
      [],
      `unexpected evidence writers: ${JSON.stringify(live)}`,
    );

    // Plant under scripts/ (not the three deploy shells) — proves the scan is not path-bound.
    // Keep writeFile* away from evidence-dir path literals in this test file
    // (see deployments-mutation-policy).
    const plantedRel = "scripts/_planted-svm-evidence-writer.ts";
    const plantedAbs = join(ROOT, plantedRel);
    assert.equal(existsSync(plantedAbs), false, "planted file must not pre-exist");
    writeFileSync(
      plantedAbs,
      [
        `// planted violation for svm-devnet-evidence-write-policy`,
        `export function plant() {`,
        `  writeSvmDevnetEvidence("tmp-evidence.json", {} as never);`,
        `}`,
        ``,
      ].join("\n"),
    );
    try {
      const plantedHits = findSvmEvidenceWriteViolations(ROOT);
      assert.ok(
        plantedHits.some((h) => h.path === plantedRel),
        `expected planted hit at ${plantedRel}, got ${JSON.stringify(plantedHits)}`,
      );
      assert.match(
        plantedHits.find((h) => h.path === plantedRel)!.reason,
        /writeSvmDevnetEvidence/,
      );
    } finally {
      rmSync(plantedAbs, { force: true });
    }

    assert.deepEqual(findSvmEvidenceWriteViolations(ROOT), []);
  });

  it("writeSvmDevnetEvidence is deleted from write-deployment and has no live writer hits", () => {
    const writeDeployment = readFileSync(
      join(ROOT, "scripts/lib/write-deployment.ts"),
      "utf8",
    );
    assert.doesNotMatch(writeDeployment, /writeSvmDevnetEvidence/);
    assert.doesNotMatch(writeDeployment, /\bexport function writeSvm/);
    const writerHits = findSvmEvidenceWriteViolations(ROOT).filter((h) =>
      h.reason.includes("writeSvmDevnetEvidence"),
    );
    assert.deepEqual(writerHits, []);
  });

  it("constructed classify: writeSvmDevnetEvidence and shell redirect detected", () => {
    assert.equal(
      classifyEvidenceWriteViolation("writeSvmDevnetEvidence(path, doc)"),
      "retired blank writer writeSvmDevnetEvidence",
    );
    // Build redirect without a contiguous evidence-dir path literal beside writeFile*.
    const redirect =
      "cat > " + ["deployments", "svm-40168.json"].join("/") + " <<EOF\n{}\nEOF";
    assert.equal(
      classifyEvidenceWriteViolation(redirect),
      "shell redirection into svm evidence json under deployments",
    );
  });
});
