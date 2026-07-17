import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IndexedPassportMetadata } from "../lib/passport/index-passport-metadata.ts";
import {
  DISPUTE_WITHDRAWN_PREFIX,
  isDisputeWithdrawnRecord,
} from "../lib/passport/index-passport-metadata.ts";
import {
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
import { passportMetadataDenorm } from "../src/lib/ponder-passport-metadata.ts";
import {
  authorizationDeactivatedPatch,
  authorizationNotificationItems,
  authorizationTermsUpdatedPatch,
  marketplaceAgentAuthorizedRow,
  marketplaceAgentReauthorizedPatch,
} from "../src/lib/ponder-agent-authorization.ts";

const OWNER = "0x2C46B2310E2cb09b0FEeDd174D9CD3870137F594";
const FIRST_AGENT = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const SECOND_AGENT = "0xB13D264368C8cbcc8EC973D1E5DDBa435eA458Ce";

describe("marketplace agent authorization lifecycle", () => {
  it("stores event casing and initializes all grant timestamps", () => {
    const row = marketplaceAgentAuthorizedRow({
      tokenId: "1",
      owner: OWNER,
      agent: FIRST_AGENT,
      expiry: 500n,
      ownerMinPrice1e8: 10_000n,
      timestamp: 100n,
    });

    assert.equal(row.id, `1-${FIRST_AGENT.toLowerCase()}`);
    assert.equal(row.owner, OWNER);
    assert.equal(row.agent, FIRST_AGENT);
    assert.equal(row.createdAt, 100n);
    assert.equal(row.updatedAt, 100n);
    assert.equal(row.authorizedAt, 100n);
  });

  it("refreshes grant time without overwriting row creation time", () => {
    const row = marketplaceAgentAuthorizedRow({
      tokenId: "1",
      owner: OWNER,
      agent: SECOND_AGENT,
      expiry: 900n,
      ownerMinPrice1e8: 20_000n,
      timestamp: 200n,
    });
    const patch = marketplaceAgentReauthorizedPatch(row);

    assert.equal("createdAt" in patch, false);
    assert.equal(patch.active, true);
    assert.equal(patch.updatedAt, 200n);
    assert.equal(patch.authorizedAt, 200n);
  });

  it("updates terms without retriggering the authorization timestamp", () => {
    const patch = authorizationTermsUpdatedPatch(30_000n, 300n);

    assert.deepEqual(patch, {
      ownerMinPrice1e8: 30_000n,
      updatedAt: 300n,
    });
    assert.equal("authorizedAt" in patch, false);
  });

  it("deactivates on revoke or terminal cleanup at the touching event time", () => {
    assert.deepEqual(authorizationDeactivatedPatch(400n), {
      active: false,
      updatedAt: 400n,
    });
  });
});

describe("authorization notification projection", () => {
  const rows = [
    {
      tokenId: "1",
      owner: OWNER,
      agent: FIRST_AGENT,
      active: false,
      authorizedAt: 100n,
    },
    {
      tokenId: "1",
      owner: OWNER,
      agent: SECOND_AGENT,
      active: true,
      authorizedAt: 200n,
    },
  ];

  it("emits a replacement marketplace grant for the new agent only", () => {
    assert.deepEqual(
      authorizationNotificationItems(
        rows,
        "agent.authorized",
        FIRST_AGENT,
        0n,
      ),
      [],
    );
    assert.deepEqual(
      authorizationNotificationItems(
        rows,
        "agent.authorized",
        SECOND_AGENT,
        0n,
      ),
      [
        {
          id: "agent.authorized:1:200",
          type: "agent.authorized",
          tokenId: "1",
          timestamp: "200",
          actor: OWNER,
        },
      ],
    );
    assert.deepEqual(
      authorizationNotificationItems(
        rows,
        "agent.authorized",
        SECOND_AGENT.toLowerCase(),
        0n,
      ),
      [],
    );
  });

  it("excludes revoked rows and applies a strict since boundary", () => {
    assert.deepEqual(
      authorizationNotificationItems(
        rows,
        "agent.authorized",
        SECOND_AGENT,
        200n,
      ),
      [],
    );
  });

  it("emits auction authorization with the stored owner actor", () => {
    assert.deepEqual(
      authorizationNotificationItems(
        [
          {
            tokenId: "2",
            owner: OWNER,
            agent: SECOND_AGENT,
            active: true,
            authorizedAt: 250n,
          },
        ],
        "auction_agent.authorized",
        SECOND_AGENT,
        249n,
      ),
      [
        {
          id: "auction_agent.authorized:2:250",
          type: "auction_agent.authorized",
          tokenId: "2",
          timestamp: "250",
          actor: OWNER,
        },
      ],
    );
  });
});

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
    const uphold = disputeResolvedTrustFields(true, 300n);
    assert.equal(uphold.disputeOpenedAt, 0n);
    assert.equal(uphold.disputeDeposit, null);
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
      locationLabel: "",
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
      locationLabel: "",
      coverPhotoUri: "ar://cover-tx",
    });
  });
});
