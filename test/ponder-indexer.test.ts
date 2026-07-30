import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IndexedPassportMetadata } from "../lib/passport/index-passport-metadata.ts";
import {
  DISPUTE_WITHDRAWN_PREFIX,
  isDisputeWithdrawnRecord,
} from "../lib/passport/index-passport-metadata.ts";
import {
  bridgeMintArrivalTrustFields,
  disputeExpiredTrustFields,
  disputeOutcomeUpholdsVerification,
  disputeResolvedTrustFields,
  disputeWithdrawnTrustFields,
  hadDisputeAfterResolve,
  nextVerificationResetCount,
  passportDisputedTrustFields,
  passportMintTrustFields,
  passportUriUpdatedTrustFields,
  verificationResetTrustFields,
} from "../src/lib/ponder-g1-fields.ts";
import {
  applyCustodyEvent,
  nextCustodyChain,
  originChainIdOf,
  resolveCustody,
  unionRecordsByTokenId,
} from "../src/lib/ponder-custody.ts";
import { passportMetadataDenorm } from "../src/lib/ponder-passport-metadata.ts";
import { normalizeVerifierId } from "../src/lib/ponder-verifier-lifecycle.ts";

describe("isDisputeWithdrawnRecord", () => {
  it("matches D6 convention for last disputer", () => {
    assert.equal(
      isDisputeWithdrawnRecord(
        "discrepancy",
        `${DISPUTE_WITHDRAWN_PREFIX} note`,
        "0xAbc",
        "0xabc",
      ),
      true,
    );
  });

  it("rejects other authors", () => {
    assert.equal(
      isDisputeWithdrawnRecord(
        "discrepancy",
        `${DISPUTE_WITHDRAWN_PREFIX} note`,
        "0xOther",
        "0xabc",
      ),
      false,
    );
  });

  it("rejects non-discrepancy records", () => {
    assert.equal(
      isDisputeWithdrawnRecord(
        "service",
        `${DISPUTE_WITHDRAWN_PREFIX} note`,
        "0xAbc",
        "0xabc",
      ),
      false,
    );
  });
});

describe("ponder G1 trust fields", () => {
  it("maps v2 DisputeOutcome to uphold flag", () => {
    assert.equal(disputeOutcomeUpholdsVerification(0), false);
    assert.equal(disputeOutcomeUpholdsVerification(1), true);
  });

  it("sets VERIFIED on dispute withdrawn", () => {
    const fields = disputeWithdrawnTrustFields(100n);
    assert.equal(fields.status, "VERIFIED");
    assert.equal(fields.disputeOpenedAt, 0n);
    assert.equal(fields.disputeWithdrawnAt, 100n);
    assert.equal(fields.disputeDeposit, null);
    assert.equal(fields.lastDisputeTerminal, "withdraw");
  });

  it("sets lastMetadataChangeAt on mint", () => {
    const ts = 100n;
    const fields = passportMintTrustFields(ts);
    assert.equal(fields.lastMetadataChangeAt, ts);
    assert.equal(fields.createdAt, ts);
    assert.equal(fields.updatedAt, ts);
  });

  it("sets hadDispute on dispute", () => {
    const fields = passportDisputedTrustFields(200n);
    assert.equal(fields.hadDispute, true);
    assert.equal(fields.status, "DISPUTED");
    assert.equal(fields.disputeOpenedAt, 200n);
  });

  it("clears disputeOpenedAt on resolve", () => {
    const reject = disputeResolvedTrustFields(false, 300n);
    assert.equal(reject.disputeOpenedAt, 0n);
    assert.equal(reject.disputeDeposit, null);
    assert.equal(reject.lastDisputeTerminal, "confirm");
    const uphold = disputeResolvedTrustFields(true, 300n);
    assert.equal(uphold.disputeOpenedAt, 0n);
    assert.equal(uphold.disputeDeposit, null);
    assert.equal(uphold.lastDisputeTerminal, "reject");
  });

  it("marks expire terminal as UNVERIFIED lapse", () => {
    const fields = disputeExpiredTrustFields(400n);
    assert.equal(fields.status, "UNVERIFIED");
    assert.equal(fields.lastDisputeTerminal, "expire");
    assert.equal(fields.verifier, "");
    assert.equal(fields.disputeOpenedAt, 0n);
  });

  it("keeps hadDispute sticky after resolve", () => {
    assert.equal(hadDisputeAfterResolve(true), true);
    const reject = disputeResolvedTrustFields(false, 300n);
    assert.equal("hadDispute" in reject, false);
    assert.equal(hadDisputeAfterResolve(true), true);
  });

  it("increments verificationResetCount", () => {
    assert.equal(nextVerificationResetCount(0), 1);
    assert.equal(nextVerificationResetCount(2), 3);
    const fields = verificationResetTrustFields(1, 400n);
    assert.equal(fields.verificationResetCount, 2);
    assert.equal(fields.lastVerificationResetAt, 400n);
  });

  it("bridge mint arrival clears usable trust without reset accounting", () => {
    const arrival = bridgeMintArrivalTrustFields(200n);
    assert.equal(arrival.status, "UNVERIFIED");
    assert.equal(arrival.verifier, "");
    assert.equal(arrival.verifiedAt, 0n);
    assert.equal(arrival.lastMetadataChangeAt, 200n);
    assert.equal(arrival.updatedAt, 200n);
    assert.equal("verificationResetCount" in arrival, false);
    assert.equal("lastVerificationResetAt" in arrival, false);
  });

  it("round trip: bridge mint then VerificationReset increments count once", () => {
    // Prior VERIFIED row projected UNVERIFIED on destination arrival — reset count stays 0.
    const afterBridge = bridgeMintArrivalTrustFields(200n);
    assert.equal(afterBridge.status, "UNVERIFIED");
    const priorResetCount = 0;
    // Home unlock emits VerificationReset — sole owner of reset accounting.
    const afterUnlock = verificationResetTrustFields(priorResetCount, 300n);
    assert.equal(afterUnlock.verificationResetCount, 1);
    assert.equal(afterUnlock.lastVerificationResetAt, 300n);
  });

  it("URI-edit VerificationReset still increments from existing count", () => {
    // Owner setPassportURI from VERIFIED: reset count was already 0 → 1.
    const afterEdit = verificationResetTrustFields(0, 400n);
    assert.equal(afterEdit.verificationResetCount, 1);
    // A later unlock after a prior edit would go 1 → 2.
    const afterUnlock = verificationResetTrustFields(1, 500n);
    assert.equal(afterUnlock.verificationResetCount, 2);
  });

  it("updates lastMetadataChangeAt on URI update", () => {
    const ts = 500n;
    const fields = passportUriUpdatedTrustFields(ts);
    assert.equal(fields.lastMetadataChangeAt, ts);
    assert.equal(fields.updatedAt, ts);
  });
});

describe("passportMetadataDenorm", () => {
  it("maps fuel/body/transmission from indexed metadata", () => {
    const indexed: IndexedPassportMetadata = {
      vin: "1HGBH41JXMN109186",
      make: "Honda",
      model: "Civic",
      year: 2021,
      mileageKm: 12000,
      fuelType: "Petrol",
      bodyType: "Sedan",
      transmission: "Manual",
      condition: "",
      vehicleType: "",
      colour: "",
      locationLabel: "Berlin, Germany",
      locationPlaceId: "photon:osm:N240109189",
      locationCountryCode: "DE",
      coverPhotoUri: "ar://cover-tx",
    };
    assert.deepEqual(passportMetadataDenorm(indexed), {
      vin: "1HGBH41JXMN109186",
      make: "Honda",
      model: "Civic",
      year: 2021,
      mileageKm: 12000,
      fuelType: "Petrol",
      bodyType: "Sedan",
      transmission: "Manual",
      condition: "",
      vehicleType: "",
      colour: "",
      locationLabel: "Berlin, Germany",
      locationPlaceId: "photon:osm:N240109189",
      locationCountryCode: "DE",
      coverPhotoUri: "ar://cover-tx",
    });
  });

  it("maps empty place fields when metadata has no location", () => {
    const indexed: IndexedPassportMetadata = {
      vin: "1HGBH41JXMN109186",
      make: "Honda",
      model: "Civic",
      year: 2021,
      mileageKm: 0,
      fuelType: "",
      bodyType: "",
      transmission: "",
      condition: "",
      vehicleType: "",
      colour: "",
      locationLabel: "",
      locationPlaceId: "",
      locationCountryCode: "",
      coverPhotoUri: "",
    };
    const denorm = passportMetadataDenorm(indexed);
    assert.equal(denorm.locationPlaceId, "");
    assert.equal(denorm.locationCountryCode, "");
    assert.equal(denorm.locationLabel, "");
  });
});

describe("#12 records UNION by global tokenId (hub+spoke)", () => {
  const HUB = 84532;
  const SPOKE = 11155111;
  // Origin on hub: chainId << 128 | 1
  const tokenId = ((BigInt(HUB) << 128n) | 1n).toString();

  it("unions hub and spoke provenance rows sharing one global tokenId", () => {
    const rows = [
      {
        id: "0xhub-1",
        tokenId,
        chainId: HUB,
        timestamp: 200n,
      },
      {
        id: "0xspoke-1",
        tokenId,
        chainId: SPOKE,
        timestamp: 100n,
      },
      {
        id: "0xother-1",
        tokenId: "999",
        chainId: HUB,
        timestamp: 50n,
      },
      {
        id: "0xhub-2",
        tokenId,
        chainId: HUB,
        timestamp: 100n,
      },
    ];

    const unioned = unionRecordsByTokenId(rows, tokenId);
    assert.equal(unioned.length, 3);
    assert.deepEqual(
      unioned.map((r) => r.chainId),
      [HUB, SPOKE, HUB],
    );
    assert.deepEqual(
      unioned.map((r) => r.id),
      ["0xhub-2", "0xspoke-1", "0xhub-1"],
    );
  });
});

describe("#13 custodyChain attribution", () => {
  const HUB = 84532;
  const SPOKE = 11155111;
  const tokenId = (BigInt(HUB) << 128n) | 7n;

  it("native mint sets custody to origin/home", () => {
    assert.equal(originChainIdOf(tokenId), HUB);
    const custody = nextCustodyChain(undefined, {
      kind: "native-mint",
      eventChainId: HUB,
      tokenId,
    });
    assert.equal(custody, HUB);
    const gated = resolveCustody(undefined, custody!, 100n);
    assert.deepEqual(gated, { custodyChain: HUB, custodyUpdatedAt: 100n });
  });

  it("lock leave + spoke bridge-mint → custodyChain=spoke; return unlock → home", () => {
    let state = {
      chainId: HUB,
      custodyChain: HUB,
      custodyUpdatedAt: 1n,
    };

    // Outbound: destination mint sets custody to spoke (burn does not).
    const afterBurn = applyCustodyEvent(state, { kind: "bridge-burn" }, 2n);
    assert.equal(afterBurn.custodyChain, HUB);

    state = applyCustodyEvent(
      afterBurn,
      { kind: "bridge-mint", eventChainId: SPOKE },
      3n,
    );
    assert.equal(state.custodyChain, SPOKE);
    assert.equal(state.chainId, HUB);
    assert.equal(state.custodyUpdatedAt, 3n);

    // Return: unlock on home restores custody.
    state = applyCustodyEvent(
      state,
      { kind: "custody-unlock", eventChainId: HUB },
      4n,
    );
    assert.equal(state.custodyChain, HUB);
    assert.equal(state.custodyUpdatedAt, 4n);

    // VerificationReset-on-unlock is idempotent with unlock.
    state = applyCustodyEvent(
      state,
      {
        kind: "verification-reset-home",
        eventChainId: HUB,
        originChainId: HUB,
      },
      4n,
    );
    assert.equal(state.custodyChain, HUB);
  });
});

describe("#14 out-of-order custody (monotonic gate)", () => {
  const HUB = 84532;
  const SPOKE = 11155111;
  const t2 = 200n;
  const t4 = 400n;

  it("rejects stale bridge-mint after fresher home unlock", () => {
    let state = {
      chainId: HUB,
      custodyChain: HUB,
      custodyUpdatedAt: 0n,
    };

    state = applyCustodyEvent(
      state,
      { kind: "bridge-mint", eventChainId: SPOKE },
      t2,
    );
    assert.equal(state.custodyChain, SPOKE);
    assert.equal(state.custodyUpdatedAt, t2);

    state = applyCustodyEvent(
      state,
      { kind: "custody-unlock", eventChainId: HUB },
      t4,
    );
    assert.equal(state.custodyChain, HUB);
    assert.equal(state.custodyUpdatedAt, t4);

    const stale = resolveCustody(state, SPOKE, t2);
    assert.equal(stale, null);

    const afterStale = applyCustodyEvent(
      state,
      { kind: "bridge-mint", eventChainId: SPOKE },
      t2,
    );
    assert.equal(afterStale.custodyChain, HUB);
    assert.equal(afterStale.custodyUpdatedAt, t4);
  });
});

describe("verifier chain-scoped key", () => {
  it("scopes the same address per commercial chain", () => {
    const addr = "0xAbC0000000000000000000000000000000000001";
    assert.equal(normalizeVerifierId(84532, addr), `84532-${addr.toLowerCase()}`);
    assert.equal(
      normalizeVerifierId(11155111, addr),
      `11155111-${addr.toLowerCase()}`,
    );
    assert.notEqual(
      normalizeVerifierId(84532, addr),
      normalizeVerifierId(11155111, addr),
    );
  });
});
