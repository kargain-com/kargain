import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  assertAllCommercialActiveMatchManifests,
  assertCommercialActiveSvmMatchesEvidence,
  assertCommercialActiveMatchesManifest,
} from "../scripts/lib/assert-commercial-active-manifest.ts";
import { deploymentPathForChain } from "../scripts/lib/load-deployment.ts";

const HUB = 84532;
const ETH = 11155111;
const SVM_EVIDENCE = "svm-40168.json";

function withDeploymentsDir<T>(dir: string, fn: () => T): T {
  const prev = process.env.KARGAIN_DEPLOYMENTS_DIR;
  process.env.KARGAIN_DEPLOYMENTS_DIR = dir;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.KARGAIN_DEPLOYMENTS_DIR;
    else process.env.KARGAIN_DEPLOYMENTS_DIR = prev;
  }
}

describe("assertCommercialActiveMatchesManifest", () => {
  let prevDir: string | undefined;

  before(() => {
    prevDir = process.env.KARGAIN_DEPLOYMENTS_DIR;
    delete process.env.KARGAIN_DEPLOYMENTS_DIR;
  });

  after(() => {
    if (prevDir === undefined) delete process.env.KARGAIN_DEPLOYMENTS_DIR;
    else process.env.KARGAIN_DEPLOYMENTS_DIR = prevDir;
  });

  it("passes when local N7 manifests match COMMERCIAL_ACTIVE", () => {
    assert.doesNotThrow(() => assertCommercialActiveMatchesManifest(HUB));
    assert.doesNotThrow(() => assertCommercialActiveMatchesManifest(ETH));
    assert.doesNotThrow(() => assertCommercialActiveSvmMatchesEvidence());
    assert.doesNotThrow(() => assertAllCommercialActiveMatchManifests());
  });

  it("refuses by name when the manifest file is absent", () => {
    const empty = mkdtempSync(join(tmpdir(), "kargain-manifest-absent-"));
    try {
      withDeploymentsDir(empty, () => {
        assert.throws(
          () => assertCommercialActiveMatchesManifest(HUB),
          /manifest absent/,
        );
        assert.throws(
          () => assertAllCommercialActiveMatchManifests(),
          /manifest absent/,
        );
      });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("refuses naming the field when one address mismatches", () => {
    const temp = mkdtempSync(join(tmpdir(), "kargain-manifest-mismatch-"));
    try {
      // Read live path via owner (mutation policy forbids hard-coded dir strings).
      const src = deploymentPathForChain(HUB);
      const dest = join(temp, `${HUB}.json`);
      copyFileSync(src, dest);
      const raw = JSON.parse(readFileSync(dest, "utf8")) as Record<
        string,
        unknown
      >;
      raw.karPassport = "0x0000000000000000000000000000000000000001";
      writeFileSync(dest, JSON.stringify(raw));

      withDeploymentsDir(temp, () => {
        assert.throws(
          () => assertCommercialActiveMatchesManifest(HUB),
          /karPassport/,
        );
      });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("refuses naming indexFromBlock on block mismatch", () => {
    const temp = mkdtempSync(join(tmpdir(), "kargain-manifest-block-"));
    try {
      const src = deploymentPathForChain(ETH);
      const dest = join(temp, `${ETH}.json`);
      copyFileSync(src, dest);
      const raw = JSON.parse(readFileSync(dest, "utf8")) as Record<
        string,
        unknown
      >;
      raw.indexFromBlock = 1;
      writeFileSync(dest, JSON.stringify(raw));

      withDeploymentsDir(temp, () => {
        assert.throws(
          () => assertCommercialActiveMatchesManifest(ETH),
          /indexFromBlock/,
        );
      });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("deploymentPathForChain follows KARGAIN_DEPLOYMENTS_DIR", () => {
    const temp = mkdtempSync(join(tmpdir(), "kargain-manifest-path-"));
    try {
      withDeploymentsDir(temp, () => {
        assert.equal(deploymentPathForChain(HUB), join(temp, `${HUB}.json`));
      });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("refuses by name when the SVM evidence file is absent", () => {
    const empty = mkdtempSync(join(tmpdir(), "kargain-svm-evidence-absent-"));
    try {
      withDeploymentsDir(empty, () => {
        assert.throws(
          () => assertCommercialActiveSvmMatchesEvidence(),
          /evidence absent or unreadable/,
        );
      });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("refuses naming the SVM field when one program id mismatches", () => {
    const temp = mkdtempSync(join(tmpdir(), "kargain-svm-evidence-mismatch-"));
    try {
      copyFileSync(join(process.cwd(), "deployments", SVM_EVIDENCE), join(temp, SVM_EVIDENCE));
      const dest = join(temp, SVM_EVIDENCE);
      const raw = JSON.parse(readFileSync(dest, "utf8")) as Record<string, unknown>;
      const programs = raw.programs as Record<string, Record<string, unknown>>;
      programs.kar_passport = {
        ...programs.kar_passport,
        programId: "11111111111111111111111111111111",
      };
      raw.programs = programs;
      writeFileSync(dest, JSON.stringify(raw));

      withDeploymentsDir(temp, () => {
        assert.throws(
          () => assertCommercialActiveSvmMatchesEvidence(),
          /karPassport/,
        );
      });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("refuses naming the SVM field when one deploySlot mismatches", () => {
    const temp = mkdtempSync(join(tmpdir(), "kargain-svm-slot-mismatch-"));
    try {
      copyFileSync(join(process.cwd(), "deployments", SVM_EVIDENCE), join(temp, SVM_EVIDENCE));
      const dest = join(temp, SVM_EVIDENCE);
      const raw = JSON.parse(readFileSync(dest, "utf8")) as Record<string, unknown>;
      const programs = raw.programs as Record<string, Record<string, unknown>>;
      programs.kar_pro_staking = {
        ...programs.kar_pro_staking,
        deploySlot: 1,
      };
      raw.programs = programs;
      writeFileSync(dest, JSON.stringify(raw));

      withDeploymentsDir(temp, () => {
        assert.throws(
          () => assertCommercialActiveSvmMatchesEvidence(),
          /blocks\.karProStaking|deploySlot/,
        );
      });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
