import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildKarProProfileFromChain,
  isKarProVerifierProfileSyncing,
  KAR_PRO_VERIFIER_POLL_INTERVAL_MS,
  KAR_PRO_VERIFIER_POLL_MAX_ATTEMPTS,
  resolveKarProJoinedAt,
  resolveKarProSlugFromMetadataUri,
  shouldPollKarProVerifierProfile,
} from "../lib/kar-pro/kar-pro-verifier-profile.ts";

const SAMPLE_PROFILE = {
  chainId: 84532,
  address: "0x1",
  category: 0,
  name: "Test",
  slug: "test",
  metadataURI: "ar://x",
  active: true,
  joinedAt: 1,
  verificationCount: 0,
  verificationFee: 0n,
} as const;

describe("shouldPollKarProVerifierProfile", () => {
  it("returns false when syncWhileMissing is disabled", () => {
    assert.equal(shouldPollKarProVerifierProfile(null, 0, false), false);
  });

  it("returns false when profile data is present", () => {
    assert.equal(shouldPollKarProVerifierProfile(SAMPLE_PROFILE, 5, true), false);
  });

  it("returns poll interval while data is missing and under max attempts", () => {
    assert.equal(
      shouldPollKarProVerifierProfile(null, 0, true),
      KAR_PRO_VERIFIER_POLL_INTERVAL_MS,
    );
    assert.equal(
      shouldPollKarProVerifierProfile(null, KAR_PRO_VERIFIER_POLL_MAX_ATTEMPTS - 1, true),
      KAR_PRO_VERIFIER_POLL_INTERVAL_MS,
    );
  });

  it("stops polling after max attempts", () => {
    assert.equal(
      shouldPollKarProVerifierProfile(null, KAR_PRO_VERIFIER_POLL_MAX_ATTEMPTS, true),
      false,
    );
  });
});

describe("isKarProVerifierProfileSyncing", () => {
  it("is true while chain fallback is up and Ponder is still missing under poll budget", () => {
    assert.equal(
      isKarProVerifierProfileSyncing({
        enabled: true,
        hasChainProfile: true,
        hasPonderProfile: false,
        pollExhausted: false,
      }),
      true,
    );
  });

  it("is false when poll is exhausted", () => {
    assert.equal(
      isKarProVerifierProfileSyncing({
        enabled: true,
        hasChainProfile: true,
        hasPonderProfile: false,
        pollExhausted: true,
      }),
      false,
    );
  });

  it("is false when Ponder profile is present", () => {
    assert.equal(
      isKarProVerifierProfileSyncing({
        enabled: true,
        hasChainProfile: true,
        hasPonderProfile: true,
        pollExhausted: false,
      }),
      false,
    );
  });

  it("is false when disabled or no chain fallback", () => {
    assert.equal(
      isKarProVerifierProfileSyncing({
        enabled: false,
        hasChainProfile: true,
        hasPonderProfile: false,
        pollExhausted: false,
      }),
      false,
    );
    assert.equal(
      isKarProVerifierProfileSyncing({
        enabled: true,
        hasChainProfile: false,
        hasPonderProfile: false,
        pollExhausted: false,
      }),
      false,
    );
  });
});

describe("buildKarProProfileFromChain", () => {
  it("builds profile with chain defaults", () => {
    const profile = buildKarProProfileFromChain({
      chainId: 84532,
      address: "0xabc",
      category: 2,
      name: "Inspector Pro",
      metadataURI: "ar://meta",
      joinedAt: 1_700_000_000,
      slug: "inspector-pro",
    });

    assert.equal(profile.chainId, 84532);
    assert.equal(profile.address, "0xabc");
    assert.equal(profile.category, 2);
    assert.equal(profile.name, "Inspector Pro");
    assert.equal(profile.slug, "inspector-pro");
    assert.equal(profile.metadataURI, "ar://meta");
    assert.equal(profile.active, true);
    assert.equal(profile.joinedAt, 1_700_000_000);
    assert.equal(profile.verificationCount, 0);
  });

  it("defaults slug to empty string", () => {
    const profile = buildKarProProfileFromChain({
      chainId: 11155111,
      address: "0xabc",
      category: 5,
      name: "Other",
      metadataURI: "",
      joinedAt: 0,
    });

    assert.equal(profile.chainId, 11155111);
    assert.equal(profile.slug, "");
  });
});

describe("resolveKarProJoinedAt", () => {
  it("prefers stakedAt when set", () => {
    assert.equal(resolveKarProJoinedAt(100n, 200n), 100);
  });

  it("falls back to issuedAtTimestamp", () => {
    assert.equal(resolveKarProJoinedAt(0n, 200n), 200);
  });

  it("returns zero when both are unset", () => {
    assert.equal(resolveKarProJoinedAt(0n, 0n), 0);
  });
});

describe("resolveKarProSlugFromMetadataUri", () => {
  it("returns empty string for unsupported uri schemes", async () => {
    assert.equal(await resolveKarProSlugFromMetadataUri(""), "");
    assert.equal(await resolveKarProSlugFromMetadataUri("ipfs://abc"), "");
  });
});
