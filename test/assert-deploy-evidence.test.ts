import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertDeployEvidence,
  formatDeployEvidenceFailure,
} from "../scripts/lib/assert-deploy-evidence.ts";
import {
  NUCLEAR_ARTIFACT_RELPATHS,
  artifactDeployedBytecodeDigest,
  persistDeploymentCompileEvidence,
} from "../scripts/lib/deployment-build-info.ts";
import type { DeploymentManifest } from "../scripts/lib/load-deployment.ts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function baseManifest(
  overrides: Partial<DeploymentManifest> & {
    buildInfoId?: string;
    buildInfoSha256?: string;
    artifactDigests?: Record<string, string>;
  },
): DeploymentManifest {
  return {
    chainId: 84532,
    generation: "test",
    karPassport: "0x0000000000000000000000000000000000000001",
    karProPass: "0x0000000000000000000000000000000000000002",
    karProStaking: "0x0000000000000000000000000000000000000003",
    deployedAt: "2026-01-01T00:00:00.000Z",
    blocks: {},
    indexFromBlock: 1,
    ...overrides,
  };
}

describe("assertDeployEvidence", () => {
  let prevDir: string | undefined;
  let tmp: string;
  let evidence: { buildInfoId: string; buildInfoSha256: string };
  let digests: Record<string, string>;

  before(() => {
    prevDir = process.env.KARGAIN_DEPLOYMENTS_DIR;
    tmp = mkdtempSync(join(tmpdir(), "kargain-deploy-evidence-"));
    process.env.KARGAIN_DEPLOYMENTS_DIR = tmp;

    const passport = join(
      ROOT,
      "artifacts/contracts/KarPassport.sol/KarPassport.json",
    );
    if (!existsSync(passport)) {
      throw new Error("compile first — missing KarPassport artifact");
    }
    evidence = persistDeploymentCompileEvidence(84532);
    digests = {};
    for (const rel of NUCLEAR_ARTIFACT_RELPATHS) {
      digests[rel] = artifactDeployedBytecodeDigest(rel);
    }
  });

  after(() => {
    if (prevDir === undefined) delete process.env.KARGAIN_DEPLOYMENTS_DIR;
    else process.env.KARGAIN_DEPLOYMENTS_DIR = prevDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("happy path — intact evidence passes", () => {
    const result = assertDeployEvidence(
      baseManifest({
        buildInfoId: evidence.buildInfoId,
        buildInfoSha256: evidence.buildInfoSha256,
        artifactDigests: { ...digests },
      }),
    );
    assert.equal(result.ok, true);
  });

  it("refuses missing buildInfoId / buildInfoSha256", () => {
    const result = assertDeployEvidence(
      baseManifest({ artifactDigests: { ...digests } }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.reasons.some((r) => /buildInfoId/.test(r)));
    assert.ok(result.reasons.some((r) => /buildInfoSha256/.test(r)));
  });

  it("refuses absent stored build-info file", () => {
    const orphanTmp = mkdtempSync(join(tmpdir(), "kargain-evidence-orphan-"));
    const prev = process.env.KARGAIN_DEPLOYMENTS_DIR;
    process.env.KARGAIN_DEPLOYMENTS_DIR = orphanTmp;
    try {
      const result = assertDeployEvidence(
        baseManifest({
          buildInfoId: evidence.buildInfoId,
          buildInfoSha256: evidence.buildInfoSha256,
          artifactDigests: { ...digests },
        }),
      );
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.ok(result.reasons.some((r) => /absent/.test(r)));
    } finally {
      process.env.KARGAIN_DEPLOYMENTS_DIR = prev;
      rmSync(orphanTmp, { recursive: true, force: true });
    }
  });

  it("refuses stored build-info digest mismatch", () => {
    const path = join(tmp, "84532.build-info.json");
    const original = readFileSync(path);
    writeFileSync(path, "{}\n");
    try {
      const result = assertDeployEvidence(
        baseManifest({
          buildInfoId: evidence.buildInfoId,
          buildInfoSha256: evidence.buildInfoSha256,
          artifactDigests: { ...digests },
        }),
      );
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.ok(result.reasons.some((r) => /sha256/.test(r)));
    } finally {
      writeFileSync(path, original);
    }
  });

  it("refuses missing or empty artifactDigests", () => {
    const missing = assertDeployEvidence(
      baseManifest({
        buildInfoId: evidence.buildInfoId,
        buildInfoSha256: evidence.buildInfoSha256,
      }),
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.ok(missing.reasons.some((r) => /artifactDigests/.test(r)));
    }

    const empty = assertDeployEvidence(
      baseManifest({
        buildInfoId: evidence.buildInfoId,
        buildInfoSha256: evidence.buildInfoSha256,
        artifactDigests: {},
      }),
    );
    assert.equal(empty.ok, false);
  });

  it("refuses on-disk artifact digest drift", () => {
    const drifted = { ...digests };
    const key = NUCLEAR_ARTIFACT_RELPATHS[0];
    drifted[key] = createHash("sha256").update("not-the-bytecode").digest("hex");
    const result = assertDeployEvidence(
      baseManifest({
        buildInfoId: evidence.buildInfoId,
        buildInfoSha256: evidence.buildInfoSha256,
        artifactDigests: drifted,
      }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.reasons.some((r) => /drifted|rebuilt/.test(r)));
    assert.match(formatDeployEvidenceFailure(result), /Deploy evidence check failed/);
  });

  it("is read-only — does not rewrite build-info", () => {
    const path = join(tmp, "84532.build-info.json");
    const before = readFileSync(path);
    assertDeployEvidence(
      baseManifest({
        buildInfoId: evidence.buildInfoId,
        buildInfoSha256: evidence.buildInfoSha256,
        artifactDigests: { ...digests },
      }),
    );
    assert.deepEqual(readFileSync(path), before);
  });
});
