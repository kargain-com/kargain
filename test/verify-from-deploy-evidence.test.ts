import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  persistDeploymentCompileEvidence,
} from "../scripts/lib/deployment-build-info.ts";
import type { DeploymentManifest } from "../scripts/lib/load-deployment.ts";
import {
  encodeConstructorArgumentsHex,
  verifyManifestFromDeployEvidence,
} from "../scripts/lib/verify-from-deploy-evidence.ts";
import {
  DISPUTE_DEPOSIT,
  karPassportConstructorArgs,
  karPassportBridgeGatewayConstructorArgs,
  karProStakingConstructorArgs,
} from "../scripts/lib/verify-constructor-args.ts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function baseManifest(overrides: Partial<DeploymentManifest> = {}): DeploymentManifest {
  return {
    chainId: 84532,
    generation: "test",
    karPassport: "0x0000000000000000000000000000000000000001",
    karProPass: "0x0000000000000000000000000000000000000002",
    karProStaking: "0x0000000000000000000000000000000000000003",
    forfeitRecipient: "0x0000000000000000000000000000000000000004",
    deployer: "0x0000000000000000000000000000000000000005",
    layerZeroEndpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f",
    deployedAt: "2026-01-01T00:00:00.000Z",
    blocks: {},
    indexFromBlock: 1,
    ...overrides,
  };
}

describe("verify-from-deploy-evidence", () => {
  let prevDir: string | undefined;
  let tmp: string;
  let evidence: { buildInfoId: string; buildInfoSha256: string };

  before(() => {
    prevDir = process.env.KARGAIN_DEPLOYMENTS_DIR;
    tmp = mkdtempSync(join(tmpdir(), "kargain-verify-evidence-"));
    process.env.KARGAIN_DEPLOYMENTS_DIR = tmp;
    const passport = join(
      ROOT,
      "artifacts/contracts/KarPassport.sol/KarPassport.json",
    );
    try {
      evidence = persistDeploymentCompileEvidence(84532);
    } catch (err) {
      throw new Error(
        `compile first — ${err instanceof Error ? err.message : err} (${passport})`,
      );
    }
  });

  after(() => {
    if (prevDir === undefined) delete process.env.KARGAIN_DEPLOYMENTS_DIR;
    else process.env.KARGAIN_DEPLOYMENTS_DIR = prevDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("encodes Passport / Staking / Gateway ctor args without 0x prefix", () => {
    const m = baseManifest({
      buildInfoId: evidence.buildInfoId,
      buildInfoSha256: evidence.buildInfoSha256,
      artifactDigests: { stub: "x" },
    });
    const passportHex = encodeConstructorArgumentsHex(
      84532,
      "contracts/KarPassport.sol:KarPassport",
      karPassportConstructorArgs(m),
    );
    assert.equal(passportHex.startsWith("0x"), false);
    assert.equal(passportHex.length, 64 * 4);
    // dispute deposit uint256 slot = 10_000_000_000_000_000n
    assert.ok(passportHex.toLowerCase().includes(DISPUTE_DEPOSIT.toString(16)));

    const stakingHex = encodeConstructorArgumentsHex(
      84532,
      "contracts/KarProStaking.sol:KarProStaking",
      karProStakingConstructorArgs(m),
    );
    assert.equal(stakingHex.length, 64 * 2);

    const gwHex = encodeConstructorArgumentsHex(
      84532,
      "contracts/KarPassportBridgeGateway.sol:KarPassportBridgeGateway",
      karPassportBridgeGatewayConstructorArgs(m),
    );
    assert.equal(gwHex.length, 64 * 3);
  });

  it("refuses when deploy evidence is missing", async () => {
    const orphan = mkdtempSync(join(tmpdir(), "kargain-verify-orphan-"));
    const prev = process.env.KARGAIN_DEPLOYMENTS_DIR;
    process.env.KARGAIN_DEPLOYMENTS_DIR = orphan;
    writeFileSync(
      join(orphan, "84532.json"),
      JSON.stringify(
        baseManifest({
          buildInfoId: "missing",
          buildInfoSha256: "00".repeat(32),
        }),
      ),
    );
    try {
      await assert.rejects(
        () =>
          verifyManifestFromDeployEvidence({
            manifest: baseManifest({
              buildInfoId: "missing",
              buildInfoSha256: "00".repeat(32),
            }),
            apiKey: "test",
            order: ["karPassport"],
          }),
        /Deploy evidence check failed/,
      );
    } finally {
      process.env.KARGAIN_DEPLOYMENTS_DIR = prev;
      rmSync(orphan, { recursive: true, force: true });
    }
  });
});
