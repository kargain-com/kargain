import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  VERIFICATION_INSTANCE,
  deriveChallengeSurface,
  isAvailable,
} from "@/lib/challenge";
import {
  derivePassportActionSurface,
  editMetadataRefusalCopy,
  resolvePassportEditAccess,
  type DerivePassportActionSurfaceInput,
} from "../lib/passport/action-surface.ts";
import { derivePassportPresence } from "../lib/passport/presence.ts";

const OWNER = "0x1111111111111111111111111111111111111111";
const VERIFIER = "0x2222222222222222222222222222222222222222";
const WALLET = "0x3333333333333333333333333333333333333333";

function challengeHere(wallet: string = WALLET) {
  return deriveChallengeSurface(VERIFICATION_INSTANCE, {
    challenge: null,
    wallet,
    isActiveVerifier: true,
    passportStatus: "VERIFIED",
    owner: OWNER,
    recordedVerifier: VERIFIER,
    opener: "",
    nowSec: 1_700_000_000,
    requireDisputedStatus: true,
  });
}

function baseInput(
  overrides: Partial<DerivePassportActionSurfaceInput> = {},
): DerivePassportActionSurfaceInput {
  return {
    presence: derivePassportPresence({
      viewChainId: 84532,
      custodyLocked: false,
      ponderCustodyChain: 84532,
    }),
    challenge: challengeHere(),
    wallet: WALLET,
    isOwner: true,
    holder: true,
    isActiveVerifier: false,
    status: "VERIFIED",
    listingActive: false,
    ...overrides,
  };
}

const WRITE_KEYS = [
  "editMetadata",
  "verify",
  "appendRecord",
  "ownerClarification",
  "reportDiscrepancy",
  "appendAttestation",
  "open",
  "withdraw",
  "judge",
  "conclude",
] as const;

describe("derivePassportActionSurface — presence", () => {
  it("blocks every contract-gated write with away when locked", () => {
    const surface = derivePassportActionSurface(
      baseInput({
        presence: derivePassportPresence({
          viewChainId: 84532,
          custodyLocked: true,
          ponderCustodyChain: 11155111,
        }),
      }),
    );
    assert.equal(surface.presence.status, "away");
    assert.match(surface.presenceCopy, /Return/);
    for (const key of WRITE_KEYS) {
      const gate = surface[key];
      assert.equal(isAvailable(gate), false, key);
      assert.equal(gate.status === "blocked" && gate.cause, "away", key);
    }
  });

  it("blocks every write with reads_unresolved when lock unread", () => {
    const surface = derivePassportActionSurface(
      baseInput({
        presence: derivePassportPresence({
          viewChainId: 84532,
          custodyLocked: undefined,
        }),
      }),
    );
    for (const key of WRITE_KEYS) {
      const gate = surface[key];
      assert.equal(isAvailable(gate), false, key);
      assert.equal(
        gate.status === "blocked" && gate.cause,
        "reads_unresolved",
        key,
      );
    }
  });

  it("when here, open remains available for VERIFIED non-owner path", () => {
    const surface = derivePassportActionSurface(
      baseInput({
        isOwner: false,
        holder: false,
        status: "VERIFIED",
        challenge: challengeHere(WALLET),
      }),
    );
    assert.equal(isAvailable(surface.open), true);
    assert.equal(isAvailable(surface.editMetadata), false);
    assert.equal(
      surface.editMetadata.status === "blocked" && surface.editMetadata.cause,
      "not_owner",
    );
  });

  it("when here, edit/appendRecord follow owner listing rules", () => {
    const ok = derivePassportActionSurface(baseInput({ status: "UNVERIFIED" }));
    assert.equal(isAvailable(ok.editMetadata), true);
    assert.equal(isAvailable(ok.appendRecord), true);

    const disputed = derivePassportActionSurface(
      baseInput({ status: "DISPUTED" }),
    );
    assert.equal(isAvailable(disputed.editMetadata), false);
    assert.equal(
      disputed.editMetadata.status === "blocked" &&
        disputed.editMetadata.cause,
      "disputed",
    );
  });

  it("when here, discrepancy withheld for holder; attestation for verifier", () => {
    const holder = derivePassportActionSurface(
      baseInput({ isOwner: true, holder: true }),
    );
    assert.equal(isAvailable(holder.reportDiscrepancy), false);

    const stranger = derivePassportActionSurface(
      baseInput({
        isOwner: false,
        holder: false,
        isActiveVerifier: true,
        status: "UNVERIFIED",
      }),
    );
    assert.equal(isAvailable(stranger.reportDiscrepancy), true);
    assert.equal(isAvailable(stranger.verify), true);
    assert.equal(isAvailable(stranger.appendAttestation), true);
  });
});

describe("resolvePassportEditAccess", () => {
  const here = derivePassportPresence({
    viewChainId: 84532,
    custodyLocked: false,
    ponderCustodyChain: 84532,
  });
  const away = derivePassportPresence({
    viewChainId: 84532,
    custodyLocked: true,
    ponderCustodyChain: 11155111,
  });
  const unresolved = derivePassportPresence({
    viewChainId: 84532,
    custodyLocked: undefined,
  });

  it("allows when here, configured, not disputed, not mode-held", () => {
    const access = resolvePassportEditAccess({
      presence: here,
      status: "VERIFIED",
      listingActive: false,
      configured: true,
    });
    assert.equal(access.status, "allow");
  });

  it("refuses not_configured before presence causes", () => {
    const access = resolvePassportEditAccess({
      presence: unresolved,
      status: "VERIFIED",
      listingActive: false,
      configured: false,
    });
    assert.equal(access.status, "refuse");
    assert.equal(access.status === "refuse" && access.cause, "not_configured");
  });

  it("refuses away and reads_unresolved from presence", () => {
    const a = resolvePassportEditAccess({
      presence: away,
      status: "VERIFIED",
      listingActive: false,
      configured: true,
    });
    assert.equal(a.status === "refuse" && a.cause, "away");

    const u = resolvePassportEditAccess({
      presence: unresolved,
      status: "VERIFIED",
      listingActive: false,
      configured: true,
    });
    assert.equal(u.status === "refuse" && u.cause, "reads_unresolved");
  });

  it("refuses disputed and listing_active when here", () => {
    const d = resolvePassportEditAccess({
      presence: here,
      status: "DISPUTED",
      listingActive: false,
      configured: true,
    });
    assert.equal(d.status === "refuse" && d.cause, "disputed");

    const l = resolvePassportEditAccess({
      presence: here,
      status: "VERIFIED",
      listingActive: true,
      configured: true,
    });
    assert.equal(l.status === "refuse" && l.cause, "listing_active");
  });

  it("presence away wins over disputed and listing_active", () => {
    const access = resolvePassportEditAccess({
      presence: away,
      status: "DISPUTED",
      listingActive: true,
      configured: true,
    });
    assert.equal(access.status === "refuse" && access.cause, "away");
  });
});

describe("editMetadataRefusalCopy", () => {
  it("reuses presence away copy and names other causes", () => {
    const away = derivePassportPresence({
      viewChainId: 84532,
      custodyLocked: true,
      ponderCustodyChain: 11155111,
    });
    const unresolved: ReturnType<typeof derivePassportPresence> = {
      status: "unresolved",
    };
    const here: ReturnType<typeof derivePassportPresence> = { status: "here" };

    assert.match(editMetadataRefusalCopy("away", away), /Return/);
    assert.match(
      editMetadataRefusalCopy("reads_unresolved", unresolved),
      /Waiting for chain custody/,
    );
    assert.match(editMetadataRefusalCopy("disputed", here), /challenge/);
    assert.match(editMetadataRefusalCopy("listing_active", here), /delisting/);
    assert.match(
      editMetadataRefusalCopy("not_configured", unresolved),
      /not configured/i,
    );
  });
});

describe("actions panel consumes action-surface", () => {
  it("panel imports derivePassportActionSurface and does not decide presence", () => {
    const src = readFileSync(
      join(process.cwd(), "components/passport/passport-actions-panel.tsx"),
      "utf8",
    );
    assert.match(src, /derivePassportActionSurface/);
    assert.match(src, /derivePassportPresence/);
    assert.match(src, /isAvailable\(actionSurface\./);
  });

  it("edit route names refusals via action-surface and reserves notFound for absence", () => {
    const src = readFileSync(
      join(process.cwd(), "app/passport/[tokenId]/edit/page.tsx"),
      "utf8",
    );
    assert.match(src, /resolvePassportEditAccess/);
    assert.match(src, /editMetadataRefusalCopy/);
    assert.match(src, /NOT_FOUND/);
    assert.match(src, /PONDER_UNAVAILABLE/);
    assert.doesNotMatch(
      src,
      /if \(passport\.status === "DISPUTED"\) notFound\(\)/,
    );
    assert.doesNotMatch(src, /if \(presence\.status !== "here"\) notFound\(\)/);
  });
});
