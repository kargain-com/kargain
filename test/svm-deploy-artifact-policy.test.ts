/**
 * svm-deploy-artifact sole-owner policy — ELF arch gate + dual-path ban.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEPLOY_ARTIFACT_PURPOSES,
  formatDeployArtifactRefusal,
  readSbfEFlagsFromBytes,
  resolveDeployArtifact,
  SHIPPING_DEPLOY_DIR_REL,
  SHIPPING_E_FLAGS,
  STAND_DEPLOY_DIR_REL,
  STAND_PRELOAD_E_FLAGS,
  synthesizeElf64WithEFlags,
} from "../scripts/lib/svm-deploy-artifact.ts";
import {
  assertStandProgramSoArch,
  STAND_ARTIFACT_WRONG_ARCH,
} from "../svm/stand/stand-artifact-bindings.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("svm-deploy-artifact-policy", () => {
  it("ELF e_flags both directions + garbage", () => {
    const v0 = synthesizeElf64WithEFlags(STAND_PRELOAD_E_FLAGS);
    const v3 = synthesizeElf64WithEFlags(SHIPPING_E_FLAGS);
    assert.deepEqual(readSbfEFlagsFromBytes(v0), {
      ok: true,
      eFlags: STAND_PRELOAD_E_FLAGS,
    });
    assert.deepEqual(readSbfEFlagsFromBytes(v3), {
      ok: true,
      eFlags: SHIPPING_E_FLAGS,
    });
    assert.equal(readSbfEFlagsFromBytes(new Uint8Array([1, 2, 3])).ok, false);
    const notElf = new Uint8Array(64);
    assert.equal(readSbfEFlagsFromBytes(notElf).ok, false);
  });

  it("resolve: stand accepts 0x0 and refuses 0x3; ship accepts 0x3 and refuses 0x0", () => {
    const dir = mkdtempSync(join(tmpdir(), "kargain-deploy-artifact-"));
    try {
      writeFileSync(
        join(dir, "kar_passport.so"),
        synthesizeElf64WithEFlags(STAND_PRELOAD_E_FLAGS),
      );
      const standOk = resolveDeployArtifact({
        purpose: "stand_preload",
        stem: "kar_passport",
        soDir: dir,
      });
      assert.equal(standOk.ok, true);

      const shipRefuse = resolveDeployArtifact({
        purpose: "upgradeable_ship",
        stem: "kar_passport",
        soDir: dir,
      });
      assert.equal(shipRefuse.ok, false);
      if (shipRefuse.ok) throw new Error("expected refuse");
      assert.equal(shipRefuse.cause, "artifact_wrong_arch");
      assert.match(formatDeployArtifactRefusal(shipRefuse), /artifact_wrong_arch/);

      writeFileSync(
        join(dir, "kar_passport.so"),
        synthesizeElf64WithEFlags(SHIPPING_E_FLAGS),
      );
      const shipOk = resolveDeployArtifact({
        purpose: "upgradeable_ship",
        stem: "kar_passport",
        soDir: dir,
      });
      assert.equal(shipOk.ok, true);

      const standRefuse = resolveDeployArtifact({
        purpose: "stand_preload",
        stem: "kar_passport",
        soDir: dir,
      });
      assert.equal(standRefuse.ok, false);
      if (standRefuse.ok) throw new Error("expected refuse");
      assert.equal(standRefuse.cause, "artifact_wrong_arch");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("upgrade plant: v0 under fake so-dir refuses shipping purpose", () => {
    const dir = mkdtempSync(join(tmpdir(), "kargain-upgrade-v0-"));
    try {
      writeFileSync(
        join(dir, "kar_gateway.so"),
        synthesizeElf64WithEFlags(STAND_PRELOAD_E_FLAGS),
      );
      const r = resolveDeployArtifact({
        purpose: "upgradeable_ship",
        stem: "kar_gateway",
        soDir: dir,
      });
      assert.equal(r.ok, false);
      if (r.ok) throw new Error("expected refuse");
      assert.equal(r.cause, "artifact_wrong_arch");
      assert.equal(r.measuredEFlags, STAND_PRELOAD_E_FLAGS);
      assert.equal(r.expectedEFlags, SHIPPING_E_FLAGS);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stand plant: v3 SO → stand_artifact_wrong_arch", () => {
    const dir = mkdtempSync(join(tmpdir(), "kargain-stand-v3-"));
    try {
      const so = join(dir, "kar_passport.so");
      writeFileSync(so, synthesizeElf64WithEFlags(SHIPPING_E_FLAGS));
      assert.throws(
        () => assertStandProgramSoArch(so, "preload"),
        (err: unknown) =>
          err instanceof Error &&
          err.message.includes(STAND_ARTIFACT_WRONG_ARCH),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("missing artifact named", () => {
    const r = resolveDeployArtifact({
      purpose: "upgradeable_ship",
      stem: "kar_passport",
      soDir: join(tmpdir(), "no-such-deploy-dir-kargain"),
    });
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("expected refuse");
    assert.equal(r.cause, "artifact_missing");
  });

  it("purpose specs pin dirs and flags", () => {
    assert.equal(
      DEPLOY_ARTIFACT_PURPOSES.stand_preload.outDirRel,
      STAND_DEPLOY_DIR_REL,
    );
    assert.equal(
      DEPLOY_ARTIFACT_PURPOSES.upgradeable_ship.outDirRel,
      SHIPPING_DEPLOY_DIR_REL,
    );
    assert.equal(STAND_DEPLOY_DIR_REL, "svm/target/deploy");
    assert.equal(SHIPPING_DEPLOY_DIR_REL, "svm/target/deploy-v3");
    assert.equal(DEPLOY_ARTIFACT_PURPOSES.stand_preload.arch, "v0");
    assert.equal(DEPLOY_ARTIFACT_PURPOSES.upgradeable_ship.arch, "v3");
  });

  it("upgrade/extend consume owner; no dual soPath; default deploy-v3", () => {
    const upgrade = readFileSync(
      join(ROOT, "scripts/svm-upgrade-in-place.ts"),
      "utf8",
    );
    const extend = readFileSync(
      join(ROOT, "scripts/svm-program-extend.ts"),
      "utf8",
    );
    assert.match(upgrade, /requireDeployArtifact/);
    assert.match(upgrade, /from ["'].*svm-deploy-artifact/);
    assert.match(extend, /requireDeployArtifact/);
    assert.match(extend, /from ["'].*svm-deploy-artifact/);
    assert.doesNotMatch(
      upgrade,
      /function soPathForEvidenceKey\(soDir: string, evidenceKey: string\): string \{\s*const p = join/,
    );
    assert.match(upgrade, /deploy-v3/);
    assert.match(extend, /deploy-v3/);
    assert.match(upgrade, /deployArtifactOutDirAbs\(["']upgradeable_ship["']\)/);
    assert.match(extend, /deployArtifactOutDirAbs\(["']upgradeable_ship["']\)/);
  });

  it("live deploy shells build via owner into deploy-v3 — no raw cargo into target/deploy", () => {
    for (const rel of [
      "svm/scripts/deploy-devnet.sh",
      "svm/scripts/deploy-s5-staking.sh",
      "svm/scripts/deploy-s9-0-modes.sh",
    ]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      assert.match(src, /svm:build-artifacts/);
      assert.match(src, /upgradeable_ship/);
      assert.match(src, /deploy-v3/);
      assert.doesNotMatch(
        src,
        /cargo-build-sbf --arch v3\)/,
        `${rel} must not invoke cargo-build-sbf --arch v3 directly`,
      );
      assert.doesNotMatch(
        src,
        /svm\/target\/deploy"/,
        `${rel} must not use stand deploy dir as --so-dir`,
      );
    }
  });

  it("pre-s7a wrappers deleted", () => {
    assert.equal(
      readFileSync.length > 0 &&
        (() => {
          try {
            readFileSync(join(ROOT, "svm/scripts/upgrade-pre-s7a-four.sh"));
            return false;
          } catch {
            return true;
          }
        })(),
      true,
    );
    try {
      readFileSync(join(ROOT, "svm/scripts/extend-pre-s7a-four.sh"));
      assert.fail("extend-pre-s7a-four.sh must be deleted");
    } catch {
      /* expected */
    }
  });
});
