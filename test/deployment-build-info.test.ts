import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
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
  deploymentArtifactsDirForChain,
  deploymentBuildInfoPathForChain,
  persistDeploymentCompileEvidence,
  readStoredBuildInfoSha256,
  restoreDeploymentCompileEvidence,
} from "../scripts/lib/deployment-build-info.ts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

describe("deployment build-info evidence", () => {
  let prevDir: string | undefined;
  let tmp: string;
  let backupBuildInfo: string | undefined;
  let buildInfoId: string;

  before(() => {
    prevDir = process.env.KARGAIN_DEPLOYMENTS_DIR;
    tmp = mkdtempSync(join(tmpdir(), "kargain-build-info-"));
    process.env.KARGAIN_DEPLOYMENTS_DIR = tmp;

    const passport = join(
      ROOT,
      "artifacts/contracts/KarPassport.sol/KarPassport.json",
    );
    if (!existsSync(passport)) {
      throw new Error("compile first — missing KarPassport artifact");
    }
    buildInfoId = (
      JSON.parse(readFileSync(passport, "utf8")) as { buildInfoId: string }
    ).buildInfoId;
    const live = join(ROOT, "artifacts/build-info", `${buildInfoId}.json`);
    backupBuildInfo = join(tmp, "backup-build-info.json");
    copyFileSync(live, backupBuildInfo);
  });

  after(() => {
    if (backupBuildInfo && buildInfoId) {
      copyFileSync(
        backupBuildInfo,
        join(ROOT, "artifacts/build-info", `${buildInfoId}.json`),
      );
    }
    if (prevDir === undefined) delete process.env.KARGAIN_DEPLOYMENTS_DIR;
    else process.env.KARGAIN_DEPLOYMENTS_DIR = prevDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("persist + restore binds build-info to chain under deploymentsDirectory", () => {
    const evidence = persistDeploymentCompileEvidence(84532);
    assert.equal(evidence.buildInfoId, buildInfoId);
    assert.equal(evidence.buildInfoSha256.length, 64);
    assert.ok(evidence.buildInfoBytes > 100_000);

    const storedPath = deploymentBuildInfoPathForChain(84532);
    assert.equal(storedPath, join(tmp, "84532.build-info.json"));
    assert.equal(readStoredBuildInfoSha256(84532), evidence.buildInfoSha256);
    assert.ok(
      readFileSync(
        join(
          deploymentArtifactsDirForChain(84532),
          "contracts/KarPassport.sol/KarPassport.json",
        ),
        "utf8",
      ).length > 0,
    );

    const artifactsBuildInfo = join(
      ROOT,
      "artifacts/build-info",
      `${evidence.buildInfoId}.json`,
    );
    writeFileSync(artifactsBuildInfo, "{}\n");
    restoreDeploymentCompileEvidence({
      chainId: 84532,
      buildInfoId: evidence.buildInfoId,
      buildInfoSha256: evidence.buildInfoSha256,
    });
    const restored = createHash("sha256")
      .update(readFileSync(artifactsBuildInfo))
      .digest("hex");
    assert.equal(restored, evidence.buildInfoSha256);
  });

  it("restore refuses digest mismatch", () => {
    assert.throws(
      () =>
        restoreDeploymentCompileEvidence({
          chainId: 84532,
          buildInfoId: buildInfoId,
          buildInfoSha256: "0".repeat(64),
        }),
      /sha256/,
    );
  });
});
