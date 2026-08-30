import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertSolanaUpgradeAuthorityMatchesDeployer,
  buildSvmDeployPlan,
  estimateRentExemptLamports,
  formatSvmDeployPlanTable,
  resolveSolanaDeployerPrivateKey,
  resolveSolanaUpgradeAuthority,
  SVM_COMMERCIAL_PROGRAMS,
} from "../scripts/lib/svm-deploy-plan.ts";

describe("svm-deploy-plan", () => {
  it("fail-closed when upgrade authority missing", () => {
    assert.throws(
      () => resolveSolanaUpgradeAuthority({}),
      /SOLANA_UPGRADE_AUTHORITY is required/,
    );
    assert.throws(
      () => buildSvmDeployPlan({ cluster: "solana-devnet", upgradeAuthority: "  " }),
      /SOLANA_UPGRADE_AUTHORITY is required/,
    );
  });

  it("refuse when SOLANA_UPGRADE_AUTHORITY ≠ deployer pubkey", () => {
    assert.throws(
      () =>
        assertSolanaUpgradeAuthorityMatchesDeployer("DeployerPub1111111111111111111111111111111", {
          SOLANA_UPGRADE_AUTHORITY: "OtherAuth111111111111111111111111111111111",
        }),
      /≠ deployer pubkey/,
    );
    assert.equal(
      assertSolanaUpgradeAuthorityMatchesDeployer("SamePub11111111111111111111111111111111111", {
        SOLANA_UPGRADE_AUTHORITY: "SamePub11111111111111111111111111111111111",
      }),
      "SamePub11111111111111111111111111111111111",
    );
  });

  it("fail-closed when deployer private key missing", () => {
    assert.throws(
      () => resolveSolanaDeployerPrivateKey({}),
      /SOLANA_DEPLOYER_PRIVATE_KEY is required/,
    );
    assert.equal(
      resolveSolanaDeployerPrivateKey({
        SOLANA_DEPLOYER_PRIVATE_KEY: "  abc  ",
      }),
      "abc",
    );
  });

  it("dry-run plan lists passport + gateway + staking + pass under retained authority", () => {
    const plan = buildSvmDeployPlan({
      cluster: "solana-devnet",
      upgradeAuthority: "HotUpgradeAuthority1111111111111111111111111",
    });
    assert.equal(plan.eid, 40168);
    assert.equal(plan.namespace, 2_000_040_168);
    assert.equal(plan.buildArch, "v3");
    assert.equal(plan.programs.length, SVM_COMMERCIAL_PROGRAMS.length);
    assert.deepEqual(
      plan.programs.map((p) => p.name),
      ["kar_passport", "kar_gateway", "kar_pro_staking", "kar_pro_pass"],
    );
    for (const p of plan.programs) {
      assert.equal(p.retainedUpgradeAuthority, plan.upgradeAuthority);
      assert.ok(p.programAccountRentLamports > 0);
    }
    const table = formatSvmDeployPlanTable(plan);
    assert.match(table, /kar_passport/);
    assert.match(table, /kar_gateway/);
    assert.match(table, /retainedUpgradeAuthority/);
    assert.match(table, /offline genesis-default/);
  });

  it("rent estimate is monotonic in data length", () => {
    const a = estimateRentExemptLamports(100);
    const b = estimateRentExemptLamports(200);
    assert.ok(b > a);
  });
});
