import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { commercialActive } from "../lib/web3/commercial-active.ts";
import {
  EID_HUB,
  EID_SPOKE,
  loadLayerZeroMetadataSnapshot,
} from "../scripts/lib/layerzero-metadata.js";
import {
  assertAppliedEnforcedBudgetMatchesSpokeVm,
  buildAppliedPathwayConfig,
  ENFORCED_GAS_SEND,
  ENFORCED_GAS_SEND_AND_COMPOSE,
  expectedEnforcedBudgetForSpokeEid,
  hashAppliedPathwayConfig,
  SOLANA_DEVNET_ENFORCED_COMPUTE,
  SOLANA_DEVNET_ENFORCED_RENT_LAMPORTS,
} from "../scripts/lib/layerzero-pathway.js";

/** Pre-S2 SPEC I.9.2 — whole-snapshot `metadataSha256`. */
const H1 =
  "0x84c7ea51e28cedf54a79d9edc81b07019ad1a47cc3d5dc08471d681e4e81cf1e";

/** Post-S2 SPEC I.9.2 — per-pathway `metadataSha256` (two chain objects). */
const H2 =
  "0x7e8c7fd4c6fbc0687a14335bfaae5d6fd4ecac1ea067ec955a6444e5893983b8";

/** Live 40245↔40168 applied hash (N7 hub + gateway_config PDA; Solana pins in digest). */
const H_40168 =
  "0x5d4b11319bdf996b2c09b17ada09abfd2c2c2b8c413a133368338b3f5f0c9c82";

const N7_HUB_GATEWAY = "0x7324046854342587999984683c4833852FA81827";
const SVM_OAPP = "J8h6ErcR6b2xqTNQ8GLJwEKfy9aodys8SC11EuBPkC1b";

/**
 * July snapshot file-body sha256 (pre-S2 committed file at 33c3056).
 * Substituting this for `metadataSha256` recovers the pre-digest-switch applied hash.
 */
const PRE_S2_SNAPSHOT_SHA256 =
  "1e0a5eda896ad43522624e5b0832e92b139076055325c1ff2e42e69072c60782";

/**
 * Hash history for 40245↔40161 (same peers, same snapshot chain objects):
 * H1 — whole-snapshot digest (pre-S2 SPEC).
 * H_mid — current applied fields + PRE_S2_SNAPSHOT_SHA256 → must equal H1
 *         (proves the topology refactor did not drift any other applied field).
 * H2 — per-pathway digest (SPEC after S2).
 * H3 — after adding 40168 → equals H2.
 */

describe("pathwayConfigHash 40245↔40161", () => {
  it("refactor neutrality: whole-snapshot digest still yields H1 (middle proof)", () => {
    const snapshot = loadLayerZeroMetadataSnapshot();
    const hub = commercialActive(84532);
    const spoke = commercialActive(11155111);
    assert.ok(hub);
    assert.ok(spoke);
    const applied = buildAppliedPathwayConfig(snapshot, {
      hubEid: EID_HUB,
      spokeEid: EID_SPOKE,
      hubOApp: hub.bridgeGateway,
      spokeOApp: spoke.bridgeGateway,
    });
    const mid = hashAppliedPathwayConfig({
      ...applied,
      metadataSha256: PRE_S2_SNAPSHOT_SHA256,
    });
    assert.equal(mid, H1);
  });

  it("matches SPEC I.9.2 against the committed snapshot (H2)", () => {
    const snapshot = loadLayerZeroMetadataSnapshot();
    const hub = commercialActive(84532);
    const spoke = commercialActive(11155111);
    assert.ok(hub);
    assert.ok(spoke);
    const applied = buildAppliedPathwayConfig(snapshot, {
      hubEid: EID_HUB,
      spokeEid: EID_SPOKE,
      hubOApp: hub.bridgeGateway,
      spokeOApp: spoke.bridgeGateway,
    });
    const hash = hashAppliedPathwayConfig(applied);
    assert.equal(hash, H2);
  });

  it("adding 40168 does not change the 40245↔40161 hash (H3 === H2)", () => {
    const snapshot = loadLayerZeroMetadataSnapshot();
    assert.ok(snapshot.chains[40168]);
    const hub = commercialActive(84532);
    const spoke = commercialActive(11155111);
    assert.ok(hub);
    assert.ok(spoke);
    const applied = buildAppliedPathwayConfig(snapshot, {
      hubEid: EID_HUB,
      spokeEid: EID_SPOKE,
      hubOApp: hub.bridgeGateway,
      spokeOApp: spoke.bridgeGateway,
    });
    assert.equal(hashAppliedPathwayConfig(applied), H2);
  });

  it("builds a distinct applied hash for hub↔40168 (N7 gateway + gateway_config PDA)", () => {
    const snapshot = loadLayerZeroMetadataSnapshot();
    const applied = buildAppliedPathwayConfig(snapshot, {
      hubEid: EID_HUB,
      spokeEid: 40168,
      hubOApp: N7_HUB_GATEWAY,
      spokeOApp: SVM_OAPP,
    });
    const hash = hashAppliedPathwayConfig(applied);
    assert.equal(hash, H_40168);
    assert.notEqual(hash, H2);
    assert.equal(applied.spokeOApp, SVM_OAPP);
    assert.deepEqual(applied.enforcedGas, expectedEnforcedBudgetForSpokeEid(40168));
    assert.equal((applied.requiredDvns[EID_HUB] as string[]).length, 2);
    assert.equal((applied.requiredDvns[40168] as string[]).length, 2);
  });
});

describe("pathwayConfigHash enforced budget class", () => {
  function evmApplied() {
    const snapshot = loadLayerZeroMetadataSnapshot();
    const hub = commercialActive(84532);
    const spoke = commercialActive(11155111);
    assert.ok(hub);
    assert.ok(spoke);
    return buildAppliedPathwayConfig(snapshot, {
      hubEid: EID_HUB,
      spokeEid: EID_SPOKE,
      hubOApp: hub.bridgeGateway,
      spokeOApp: spoke.bridgeGateway,
    });
  }

  function svmApplied() {
    const snapshot = loadLayerZeroMetadataSnapshot();
    return buildAppliedPathwayConfig(snapshot, {
      hubEid: EID_HUB,
      spokeEid: 40168,
      hubOApp: N7_HUB_GATEWAY,
      spokeOApp: SVM_OAPP,
    });
  }

  it("EVM pathway digests EVM enforced options (builder ≡ owner; hash H2)", () => {
    const applied = evmApplied();
    const expected = expectedEnforcedBudgetForSpokeEid(EID_SPOKE);
    assert.deepEqual(applied.enforcedGas, expected);
    assert.equal(applied.enforcedGas.rentLamports, undefined);
    assert.equal(applied.enforcedGas.send, ENFORCED_GAS_SEND);
    assert.equal(applied.enforcedGas.sendAndCompose, ENFORCED_GAS_SEND_AND_COMPOSE);
    assertAppliedEnforcedBudgetMatchesSpokeVm(applied);
    assert.equal(hashAppliedPathwayConfig(applied), H2);
  });

  it("SVM pathway digests Solana enforced options (builder ≡ owner; hash pinned)", () => {
    const applied = svmApplied();
    const expected = expectedEnforcedBudgetForSpokeEid(40168);
    assert.deepEqual(applied.enforcedGas, expected);
    assert.equal(applied.enforcedGas.send, SOLANA_DEVNET_ENFORCED_COMPUTE);
    assert.equal(applied.enforcedGas.sendAndCompose, SOLANA_DEVNET_ENFORCED_COMPUTE);
    assert.equal(applied.enforcedGas.rentLamports, SOLANA_DEVNET_ENFORCED_RENT_LAMPORTS);
    assertAppliedEnforcedBudgetMatchesSpokeVm(applied);
    assert.equal(hashAppliedPathwayConfig(applied), H_40168);
  });

  it("pre-cd3b913 X4 defect: SVM applied digesting EVM floors fails enforced_options_wrong_destination_class", () => {
    const applied = {
      ...svmApplied(),
      enforcedGas: {
        send: ENFORCED_GAS_SEND,
        sendAndCompose: ENFORCED_GAS_SEND_AND_COMPOSE,
      },
    };
    assert.throws(
      () => assertAppliedEnforcedBudgetMatchesSpokeVm(applied),
      (err: unknown) =>
        err instanceof Error &&
        err.message.startsWith("enforced_options_wrong_destination_class"),
    );
    assert.throws(
      () => hashAppliedPathwayConfig(applied),
      (err: unknown) =>
        err instanceof Error &&
        err.message.startsWith("enforced_options_wrong_destination_class"),
    );
  });

  it("mirror wrong class: EVM applied with Solana pins fails enforced_options_wrong_destination_class", () => {
    const applied = {
      ...evmApplied(),
      enforcedGas: expectedEnforcedBudgetForSpokeEid(40168),
    };
    assert.throws(
      () => assertAppliedEnforcedBudgetMatchesSpokeVm(applied),
      (err: unknown) =>
        err instanceof Error &&
        err.message.startsWith("enforced_options_wrong_destination_class"),
    );
    assert.throws(
      () => hashAppliedPathwayConfig(applied),
      (err: unknown) =>
        err instanceof Error &&
        err.message.startsWith("enforced_options_wrong_destination_class"),
    );
  });

  it("Solana magnitude change moves 40168 hash and leaves 40161 H2 unchanged", () => {
    const svm = svmApplied();
    const mutated = {
      ...svm,
      enforcedGas: {
        send: SOLANA_DEVNET_ENFORCED_COMPUTE + 1,
        sendAndCompose: SOLANA_DEVNET_ENFORCED_COMPUTE + 1,
        rentLamports: SOLANA_DEVNET_ENFORCED_RENT_LAMPORTS,
      },
    };
    assertAppliedEnforcedBudgetMatchesSpokeVm(mutated);
    assert.notEqual(hashAppliedPathwayConfig(mutated), H_40168);
    assert.equal(hashAppliedPathwayConfig(evmApplied()), H2);
  });

  it("EVM magnitude change moves 40161 hash and leaves 40168 pinned hash unchanged", () => {
    const evm = evmApplied();
    const mutated = {
      ...evm,
      enforcedGas: {
        send: ENFORCED_GAS_SEND + 1,
        sendAndCompose: ENFORCED_GAS_SEND_AND_COMPOSE,
      },
    };
    assertAppliedEnforcedBudgetMatchesSpokeVm(mutated);
    assert.notEqual(hashAppliedPathwayConfig(mutated), H2);
    assert.equal(hashAppliedPathwayConfig(svmApplied()), H_40168);
  });
});
