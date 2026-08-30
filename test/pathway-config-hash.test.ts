import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { commercialActive } from "../lib/web3/commercial-active.ts";
import {
  EID_HUB,
  EID_SPOKE,
  loadLayerZeroMetadataSnapshot,
} from "../scripts/lib/layerzero-metadata.js";
import {
  buildAppliedPathwayConfig,
  hashAppliedPathwayConfig,
} from "../scripts/lib/layerzero-pathway.js";

/** Pre-S2 SPEC I.9.2 — whole-snapshot `metadataSha256`. */
const H1 =
  "0x84c7ea51e28cedf54a79d9edc81b07019ad1a47cc3d5dc08471d681e4e81cf1e";

/** Post-S2 SPEC I.9.2 — per-pathway `metadataSha256` (two chain objects). */
const H2 =
  "0x7e8c7fd4c6fbc0687a14335bfaae5d6fd4ecac1ea067ec955a6444e5893983b8";

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
    const hubGateway = "0x7324046854342587999984683c4833852FA81827";
    const svmOApp = "J8h6ErcR6b2xqTNQ8GLJwEKfy9aodys8SC11EuBPkC1b";
    const applied = buildAppliedPathwayConfig(snapshot, {
      hubEid: EID_HUB,
      spokeEid: 40168,
      hubOApp: hubGateway,
      spokeOApp: svmOApp,
    });
    const hash = hashAppliedPathwayConfig(applied);
    assert.equal(
      hash,
      "0x5d4b11319bdf996b2c09b17ada09abfd2c2c2b8c413a133368338b3f5f0c9c82",
    );
    assert.notEqual(hash, H2);
    assert.equal(applied.spokeOApp, svmOApp);
    assert.equal(applied.enforcedGas.send, 139_638);
    assert.equal(applied.enforcedGas.sendAndCompose, 139_638);
    assert.equal(applied.enforcedGas.rentLamports, 10_784_520);
    assert.equal((applied.requiredDvns[EID_HUB] as string[]).length, 2);
    assert.equal((applied.requiredDvns[40168] as string[]).length, 2);
  });
});
