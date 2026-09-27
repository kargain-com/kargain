/**
 * svm-deploy-artifact sole-owner policy — ELF arch + shipping provenance + dual-path ban.
 * Plants use mkdtemp only (never scanned product roots).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  admitCommercialDeployStem,
  buildDeployArtifacts,
  DEPLOY_ARTIFACT_MANIFEST_FILE,
  DEPLOY_ARTIFACT_PURPOSES,
  formatDeployArtifactRefusal,
  readSbfEFlagsFromBytes,
  resolveDeployArtifact,
  sha256HexOfFile,
  SHIPPING_DEPLOY_DIR_REL,
  SHIPPING_E_FLAGS,
  STAND_DEPLOY_DIR_REL,
  STAND_PRELOAD_E_FLAGS,
  synthesizeElf64WithEFlags,
  writeDeployArtifactManifest,
  type DeployArtifactManifest,
} from "../scripts/lib/svm-deploy-artifact.ts";
import {
  assertStandProgramSoArch,
  STAND_ARTIFACT_WRONG_ARCH,
} from "../svm/stand/stand-artifact-bindings.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);

function sha256Hex(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

function writeShippingPlant(args: {
  dir: string;
  stem: string;
  bytes: Uint8Array;
  gitHead?: string;
  eFlags?: number;
}): { soPath: string; sha256: string } {
  const soPath = join(args.dir, `${args.stem}.so`);
  writeFileSync(soPath, args.bytes);
  const sha256 = sha256Hex(args.bytes);
  const manifest: DeployArtifactManifest = {
    purpose: "upgradeable_ship",
    gitHead: args.gitHead ?? FAKE_HEAD,
    dirty: false,
    builtAt: "2026-09-27T00:00:00.000Z",
    programs: [
      {
        stem: args.stem,
        file: `${args.stem}.so`,
        sha256,
        bytes: args.bytes.byteLength,
        eFlags: args.eFlags ?? SHIPPING_E_FLAGS,
      },
    ],
  };
  writeDeployArtifactManifest(args.dir, manifest);
  return { soPath, sha256 };
}

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

  it("stand accepts 0x0 and refuses 0x3 (arch only)", () => {
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

      writeFileSync(
        join(dir, "kar_passport.so"),
        synthesizeElf64WithEFlags(SHIPPING_E_FLAGS),
      );
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

  it("RED then green: dirty tree at shipping build", () => {
    const dir = mkdtempSync(join(tmpdir(), "kargain-build-dirty-"));
    const repo = mkdtempSync(join(tmpdir(), "kargain-repo-dirty-"));
    try {
      mkdirSync(join(repo, "svm/programs/kar-passport"), { recursive: true });
      assert.throws(
        () =>
          buildDeployArtifacts({
            purpose: "upgradeable_ship",
            programDirs: ["kar-passport"],
            repoRoot: repo,
            gitState: { dirty: true, head: FAKE_HEAD },
            runBuild: () => ({ status: 0, stdout: "", stderr: "" }),
          }),
        (err: unknown) =>
          err instanceof Error &&
          err.message.includes("deploy_artifact_dirty_tree"),
      );
      // GREEN: clean tree + injected build writes SO then manifest
      const soBytes = synthesizeElf64WithEFlags(SHIPPING_E_FLAGS);
      const result = buildDeployArtifacts({
        purpose: "upgradeable_ship",
        programDirs: ["kar-passport"],
        repoRoot: repo,
        gitState: { dirty: false, head: FAKE_HEAD },
        builtAt: "2026-09-27T00:00:00.000Z",
        runBuild: ({ outDirAbs }) => {
          writeFileSync(join(outDirAbs, "kar_passport.so"), soBytes);
          return { status: 0, stdout: "", stderr: "" };
        },
      });
      assert.equal(result.gitHead, FAKE_HEAD);
      assert.ok(result.manifestPath?.endsWith(DEPLOY_ARTIFACT_MANIFEST_FILE));
      const man = JSON.parse(
        readFileSync(result.manifestPath!, "utf8"),
      ) as DeployArtifactManifest;
      assert.equal(man.gitHead, FAKE_HEAD);
      assert.equal(man.dirty, false);
      assert.equal(man.programs[0]?.stem, "kar_passport");
      assert.equal(man.programs[0]?.sha256, sha256Hex(soBytes));
      void dir;
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("RED then green: sha mismatch after build", () => {
    const dir = mkdtempSync(join(tmpdir(), "kargain-sha-mismatch-"));
    try {
      const bytes = synthesizeElf64WithEFlags(SHIPPING_E_FLAGS);
      writeShippingPlant({ dir, stem: "kar_passport", bytes });
      const soPath = join(dir, "kar_passport.so");
      // Tamper file after manifest written
      const tampered = Buffer.from(bytes);
      tampered[60] = (tampered[60]! + 1) & 0xff;
      writeFileSync(soPath, tampered);

      const red = resolveDeployArtifact({
        purpose: "upgradeable_ship",
        stem: "kar_passport",
        soDir: dir,
        gitState: { dirty: false, head: FAKE_HEAD },
      });
      assert.equal(red.ok, false);
      if (red.ok) throw new Error("expected refuse");
      assert.equal(red.cause, "deploy_artifact_sha_mismatch");
      assert.match(formatDeployArtifactRefusal(red), /deploy_artifact_sha_mismatch/);

      // GREEN: restore matching bytes
      writeFileSync(soPath, bytes);
      const green = resolveDeployArtifact({
        purpose: "upgradeable_ship",
        stem: "kar_passport",
        soDir: dir,
        gitState: { dirty: false, head: FAKE_HEAD },
      });
      assert.equal(green.ok, true);
      if (!green.ok) throw new Error("expected ok");
      assert.equal(green.gitHead, FAKE_HEAD);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("RED then green: manifest gitHead ≠ HEAD (stale)", () => {
    const dir = mkdtempSync(join(tmpdir(), "kargain-stale-head-"));
    try {
      const bytes = synthesizeElf64WithEFlags(SHIPPING_E_FLAGS);
      writeShippingPlant({
        dir,
        stem: "kar_passport",
        bytes,
        gitHead: OTHER_HEAD,
      });
      const red = resolveDeployArtifact({
        purpose: "upgradeable_ship",
        stem: "kar_passport",
        soDir: dir,
        gitState: { dirty: false, head: FAKE_HEAD },
      });
      assert.equal(red.ok, false);
      if (red.ok) throw new Error("expected refuse");
      assert.equal(red.cause, "deploy_artifact_stale_head");

      // GREEN: HEAD matches manifest
      const green = resolveDeployArtifact({
        purpose: "upgradeable_ship",
        stem: "kar_passport",
        soDir: dir,
        gitState: { dirty: false, head: OTHER_HEAD },
      });
      assert.equal(green.ok, true);
      if (!green.ok) throw new Error("expected ok");
      assert.equal(green.gitHead, OTHER_HEAD);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("RED then green: stem outside census", () => {
    const red = admitCommercialDeployStem("mock_staking");
    assert.equal(red.ok, false);
    if (red.ok) throw new Error("expected refuse");
    assert.equal(red.cause, "deploy_artifact_unknown_program");

    const green = admitCommercialDeployStem("kar_passport");
    assert.equal(green.ok, true);
    if (!green.ok) throw new Error("expected ok");
    assert.equal(green.stem, "kar_passport");
    assert.equal(green.programDir, "kar-passport");
  });

  it("upgrade plant: v0 under shipping dir → artifact_wrong_arch", () => {
    const dir = mkdtempSync(join(tmpdir(), "kargain-upgrade-v0-"));
    try {
      const bytes = synthesizeElf64WithEFlags(STAND_PRELOAD_E_FLAGS);
      writeShippingPlant({
        dir,
        stem: "kar_gateway",
        bytes,
        eFlags: SHIPPING_E_FLAGS, // manifest claims v3 but file is v0
      });
      // Fix manifest eFlags to match file so we reach arch check after sha
      writeShippingPlant({
        dir,
        stem: "kar_gateway",
        bytes,
        eFlags: STAND_PRELOAD_E_FLAGS,
      });
      const r = resolveDeployArtifact({
        purpose: "upgradeable_ship",
        stem: "kar_gateway",
        soDir: dir,
        gitState: { dirty: false, head: FAKE_HEAD },
      });
      assert.equal(r.ok, false);
      if (r.ok) throw new Error("expected refuse");
      assert.equal(r.cause, "artifact_wrong_arch");
      assert.equal(r.measuredEFlags, STAND_PRELOAD_E_FLAGS);
      assert.equal(r.expectedEFlags, SHIPPING_E_FLAGS);
      assert.match(formatDeployArtifactRefusal(r), /measured_e_flags=0x0/);
      assert.doesNotMatch(formatDeployArtifactRefusal(r), /\?\?/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("formatDeployArtifactRefusal: e_flags_unreadable when measured absent", () => {
    const msg = formatDeployArtifactRefusal({
      ok: false,
      cause: "artifact_wrong_arch",
      path: "/tmp/x.so",
      purpose: "upgradeable_ship",
      expectedEFlags: SHIPPING_E_FLAGS,
    });
    assert.match(msg, /e_flags_unreadable/);
    assert.doesNotMatch(msg, /measured_e_flags=0x0/);
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

  it("missing artifact / missing manifest named", () => {
    const missing = resolveDeployArtifact({
      purpose: "stand_preload",
      stem: "kar_passport",
      soDir: join(tmpdir(), "no-such-deploy-dir-kargain"),
    });
    assert.equal(missing.ok, false);
    if (missing.ok) throw new Error("expected refuse");
    assert.equal(missing.cause, "artifact_missing");

    const dir = mkdtempSync(join(tmpdir(), "kargain-no-manifest-"));
    try {
      writeFileSync(
        join(dir, "kar_passport.so"),
        synthesizeElf64WithEFlags(SHIPPING_E_FLAGS),
      );
      const r = resolveDeployArtifact({
        purpose: "upgradeable_ship",
        stem: "kar_passport",
        soDir: dir,
        gitState: { dirty: false, head: FAKE_HEAD },
      });
      assert.equal(r.ok, false);
      if (r.ok) throw new Error("expected refuse");
      assert.equal(r.cause, "deploy_artifact_manifest_missing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it("upgrade/extend: no --so-dir / soPathForEvidenceKey; evidence from manifest gitHead", () => {
    const upgrade = readFileSync(
      join(ROOT, "scripts/svm-upgrade-in-place.ts"),
      "utf8",
    );
    const extend = readFileSync(
      join(ROOT, "scripts/svm-program-extend.ts"),
      "utf8",
    );
    assert.match(upgrade, /requireDeployArtifact/);
    assert.match(extend, /requireDeployArtifact/);
    assert.doesNotMatch(upgrade, /function soPathForEvidenceKey/);
    assert.doesNotMatch(extend, /function soPathForEvidenceKey/);
    assert.doesNotMatch(upgrade, /optionalArg\(["']--so-dir["']\)/);
    assert.doesNotMatch(extend, /optionalArg\(["']--so-dir["']\)/);
    assert.match(upgrade, /--so-dir removed/);
    assert.match(extend, /--so-dir removed/);
    assert.doesNotMatch(upgrade, /currentSourceGitHead\(/);
    assert.match(upgrade, /sourceGitHead/);
    assert.match(upgrade, /resolved\.gitHead/);
    assert.match(upgrade, /deploy-v3/);
    assert.match(extend, /deploy-v3/);
  });

  it("package.json pins svm:upgrade / svm:extend / svm:build-artifacts", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    assert.match(pkg.scripts["svm:build-artifacts"] ?? "", /svm-build-deploy-artifacts/);
    assert.match(pkg.scripts["svm:upgrade"] ?? "", /svm-upgrade-in-place/);
    assert.match(pkg.scripts["svm:extend"] ?? "", /svm-program-extend/);
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
        /--so-dir/,
        `${rel} must not pass --so-dir to upgrade/extend`,
      );
    }
  });

  it("pre-s7a wrappers deleted", () => {
    try {
      readFileSync(join(ROOT, "svm/scripts/upgrade-pre-s7a-four.sh"));
      assert.fail("upgrade-pre-s7a-four.sh must be deleted");
    } catch {
      /* expected */
    }
    try {
      readFileSync(join(ROOT, "svm/scripts/extend-pre-s7a-four.sh"));
      assert.fail("extend-pre-s7a-four.sh must be deleted");
    } catch {
      /* expected */
    }
  });

  it("resolve returns manifest gitHead — upgrade must not invent a separate HEAD", () => {
    const dir = mkdtempSync(join(tmpdir(), "kargain-manifest-head-"));
    try {
      const bytes = synthesizeElf64WithEFlags(SHIPPING_E_FLAGS);
      writeShippingPlant({
        dir,
        stem: "kar_passport",
        bytes,
        gitHead: OTHER_HEAD,
      });
      // Stale vs FAKE_HEAD refuses before any evidence write path can run
      const stale = resolveDeployArtifact({
        purpose: "upgradeable_ship",
        stem: "kar_passport",
        soDir: dir,
        gitState: { dirty: false, head: FAKE_HEAD },
      });
      assert.equal(stale.ok, false);
      if (stale.ok) throw new Error("expected refuse");
      assert.equal(stale.cause, "deploy_artifact_stale_head");

      const ok = resolveDeployArtifact({
        purpose: "upgradeable_ship",
        stem: "kar_passport",
        soDir: dir,
        gitState: { dirty: false, head: OTHER_HEAD },
      });
      assert.equal(ok.ok, true);
      if (!ok.ok) throw new Error("expected ok");
      assert.equal(ok.gitHead, OTHER_HEAD);
      assert.equal(sha256HexOfFile(ok.path), sha256Hex(bytes));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
