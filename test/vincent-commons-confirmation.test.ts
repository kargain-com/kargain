/**
 * F-3c confirmation tests — sign→verify roundtrip, tamper + attester-mismatch
 * rejection, kind 31862 envelope integrity, and the rebuild-match gate over a
 * fixture epoch (PASS signs; mutated JSONL / tampered manifest FAIL and never
 * sign).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compile } from "@kargain/vincent-compiler";
import {
  addressFromPrivateKey,
  manifestHash,
  sha256Hex,
  signManifest,
  signPersonalMessage,
  toChecksumAddress,
  type Manifest,
  type UnsignedManifest,
} from "@kargain/vincent/protocol";

import {
  commonsConfirmationEntryFromEvent,
  commonsConfirmationFilterForManifests,
} from "../lib/nostr/commons-confirmations.ts";
import {
  buildCommonsConfirmationEvent,
  buildUnsignedCommonsConfirmation,
  commonsConfirmationFromEvent,
  confirmationSigningPayload,
  COMMONS_CONFIRMATION_KIND,
  parseCommonsConfirmation,
  signCommonsConfirmation,
  verifyCommonsConfirmation,
  type CommonsConfirmation,
} from "../lib/vincent-commons/confirmation.ts";
import {
  verifyEpochRebuild,
  type VerifyEpochRebuildResult,
} from "../lib/vincent-commons/confirm-epoch.ts";
import { buildWmiClaim } from "../lib/vincent-commons/wmi-claim.ts";

const KEY_PUBLISHER =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY_CONFIRMER =
  "0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const KEY_OTHER =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

const ADDR_CONFIRMER = addressFromPrivateKey(KEY_CONFIRMER);

const MANIFEST_HASH_FIXTURE = `sha256:${"ab".repeat(32)}`;

function contentIdOf(text: string): string {
  return `sha256:${sha256Hex(new TextEncoder().encode(text))}`;
}

function mustBuildClaim(wmi: string, manufacturer: string) {
  const built = buildWmiClaim({ wmi, manufacturer, country: "", vehicleType: "" });
  assert.ok(built.ok, `fixture claim for ${wmi}`);
  return built.claim;
}

/** Fixture epoch: three wmi claims compiled + publisher-signed manifest. */
const FIXTURE_EPOCH = (() => {
  const claims = [
    mustBuildClaim("TES", "Example Werke GmbH"),
    mustBuildClaim("TAA", "Alpha Motors"),
    mustBuildClaim("TBB", "Beta Fahrzeuge AG"),
  ];
  const built = compile(claims, {});
  assert.ok(built.ok, "fixture epoch compiles");

  const unsigned: UnsignedManifest = {
    schemaVersion: "1.0",
    epoch: 1,
    parent: null,
    reviewPolicy: {
      minAccepts: 1,
      reviewers: [addressFromPrivateKey(KEY_PUBLISHER)],
    },
    compiler: { name: "@kargain/vincent-compiler", version: "0.1.0" },
    dataset: {
      jsonlSha256: built.value.jsonlSha256,
      merkleRoot: built.value.merkleRoot,
      uris: ["ar://fixture-dataset"],
    },
  };
  const manifest = signManifest(unsigned, KEY_PUBLISHER);
  return {
    claims,
    jsonl: built.value.jsonl,
    manifest,
    anchor: {
      manifestHash: manifestHash(manifest),
      jsonlSha256: built.value.jsonlSha256,
      merkleRoot: built.value.merkleRoot,
    },
  };
})();

/** Mirrors the CLI gate: only a green rebuild may produce a signed document. */
function signIfRebuilt(
  rebuilt: VerifyEpochRebuildResult,
  anchorManifestHash: string,
): CommonsConfirmation | null {
  return rebuilt.ok ? signCommonsConfirmation(anchorManifestHash, KEY_CONFIRMER) : null;
}

describe("confirmation — sign/verify roundtrip", () => {
  it("signs and verifies a rebuilt confirmation", () => {
    const confirmation = signCommonsConfirmation(MANIFEST_HASH_FIXTURE, KEY_CONFIRMER);
    assert.equal(confirmation.schemaVersion, "1.0");
    assert.equal(confirmation.manifest, MANIFEST_HASH_FIXTURE);
    assert.equal(confirmation.attester, toChecksumAddress(ADDR_CONFIRMER));
    assert.equal(confirmation.kind, "rebuilt");

    const verified = verifyCommonsConfirmation(confirmation);
    assert.ok(verified.ok);
    assert.equal(verified.attester, confirmation.attester);
  });

  it("rejects a tampered manifest hash", () => {
    const confirmation = signCommonsConfirmation(MANIFEST_HASH_FIXTURE, KEY_CONFIRMER);
    const tampered = { ...confirmation, manifest: `sha256:${"cd".repeat(32)}` };
    const verified = verifyCommonsConfirmation(tampered);
    assert.ok(!verified.ok);
    assert.equal(verified.reason, "address-mismatch");
  });

  it("rejects attester mismatch (signed by another key)", () => {
    const unsigned = buildUnsignedCommonsConfirmation(
      MANIFEST_HASH_FIXTURE,
      ADDR_CONFIRMER,
    );
    const signature = signPersonalMessage(
      confirmationSigningPayload(unsigned),
      KEY_OTHER,
    );
    const verified = verifyCommonsConfirmation({ ...unsigned, signature });
    assert.ok(!verified.ok);
    assert.equal(verified.reason, "address-mismatch");
  });

  it("rejects a non-checksummed attester", () => {
    const confirmation = signCommonsConfirmation(MANIFEST_HASH_FIXTURE, KEY_CONFIRMER);
    const lowered = { ...confirmation, attester: confirmation.attester.toLowerCase() };
    const verified = verifyCommonsConfirmation(lowered);
    assert.ok(!verified.ok);
    assert.equal(verified.reason, "invalid-checksum");
  });
});

describe("confirmation — wire parser", () => {
  const valid = signCommonsConfirmation(MANIFEST_HASH_FIXTURE, KEY_CONFIRMER);

  it("parses a valid document", () => {
    const parsed = parseCommonsConfirmation({ ...valid });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, valid);
  });

  it("rejects unknown keys", () => {
    const parsed = parseCommonsConfirmation({ ...valid, extra: true });
    assert.ok(!parsed.ok);
    assert.equal(parsed.reason, "unexpected-keys");
  });

  it("rejects missing keys", () => {
    const { signature: _sig, ...withoutSignature } = valid;
    const parsed = parseCommonsConfirmation(withoutSignature);
    assert.ok(!parsed.ok);
    assert.equal(parsed.reason, "unexpected-keys");
  });

  it("rejects a malformed manifest content id", () => {
    const parsed = parseCommonsConfirmation({ ...valid, manifest: "sha256:short" });
    assert.ok(!parsed.ok);
    assert.equal(parsed.reason, "invalid-manifest");
  });

  it("rejects a malformed attester", () => {
    const parsed = parseCommonsConfirmation({ ...valid, attester: "0x123" });
    assert.ok(!parsed.ok);
    assert.equal(parsed.reason, "invalid-attester");
  });

  it("rejects any kind other than rebuilt", () => {
    const parsed = parseCommonsConfirmation({ ...valid, kind: "endorse" });
    assert.ok(!parsed.ok);
    assert.equal(parsed.reason, "invalid-kind");
  });

  it("rejects a malformed signature", () => {
    const parsed = parseCommonsConfirmation({ ...valid, signature: "0xdead" });
    assert.ok(!parsed.ok);
    assert.equal(parsed.reason, "invalid-signature");
  });

  it("rejects non-objects", () => {
    for (const input of [null, undefined, "doc", 7, [valid]]) {
      const parsed = parseCommonsConfirmation(input);
      assert.ok(!parsed.ok);
      assert.equal(parsed.reason, "not-an-object");
    }
  });
});

describe("confirmation — kind 31862 envelope", () => {
  const confirmation = signCommonsConfirmation(MANIFEST_HASH_FIXTURE, KEY_CONFIRMER);
  const template = buildCommonsConfirmationEvent(confirmation, 1_700_000_000);

  it("builds d = manifestHash with JCS content", () => {
    assert.equal(template.kind, COMMONS_CONFIRMATION_KIND);
    assert.deepEqual(template.tags, [["d", MANIFEST_HASH_FIXTURE]]);
    const parsed = parseCommonsConfirmation(JSON.parse(template.content));
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, confirmation);
  });

  it("roundtrips through commonsConfirmationFromEvent", () => {
    const roundtripped = commonsConfirmationFromEvent(template);
    assert.deepEqual(roundtripped, confirmation);
  });

  it("drops wrong kinds", () => {
    assert.equal(commonsConfirmationFromEvent({ ...template, kind: 31860 }), null);
  });

  it("drops d tag mismatches", () => {
    const wrongD = { ...template, tags: [["d", `sha256:${"ef".repeat(32)}`]] };
    assert.equal(commonsConfirmationFromEvent(wrongD), null);
    assert.equal(commonsConfirmationFromEvent({ ...template, tags: [] }), null);
  });

  it("drops invalid JSON and tampered content", () => {
    assert.equal(commonsConfirmationFromEvent({ ...template, content: "{" }), null);
    const tampered = buildCommonsConfirmationEvent(
      { ...confirmation, signature: `0x${"00".repeat(65)}` },
      1_700_000_000,
    );
    assert.equal(commonsConfirmationFromEvent(tampered), null);
  });

  it("maps events to entries with author pubkey preserved", () => {
    const entry = commonsConfirmationEntryFromEvent({
      ...template,
      id: "conf-0001",
      pubkey: "pubkey-confirmer",
      created_at: template.created_at,
    });
    assert.ok(entry);
    assert.deepEqual(entry.confirmation, confirmation);
    assert.equal(entry.eventId, "conf-0001");
    assert.equal(entry.authorPubkey, "pubkey-confirmer");
  });

  it("builds a deduplicated #d filter", () => {
    const filter = commonsConfirmationFilterForManifests([
      MANIFEST_HASH_FIXTURE,
      MANIFEST_HASH_FIXTURE,
    ]);
    assert.deepEqual(filter.kinds, [COMMONS_CONFIRMATION_KIND]);
    assert.deepEqual(filter["#d"], [MANIFEST_HASH_FIXTURE]);
    assert.equal(filter.limit, 8);
  });
});

describe("confirmation — rebuild-match gate", () => {
  it("PASS: a byte-identical rebuild yields a signed confirmation", () => {
    const rebuilt = verifyEpochRebuild({
      anchor: FIXTURE_EPOCH.anchor,
      manifestJson: FIXTURE_EPOCH.manifest,
      jsonlText: FIXTURE_EPOCH.jsonl,
    });
    assert.ok(rebuilt.ok, "fixture epoch rebuilds");
    assert.equal(rebuilt.claims.length, FIXTURE_EPOCH.claims.length);

    const confirmation = signIfRebuilt(rebuilt, FIXTURE_EPOCH.anchor.manifestHash);
    assert.ok(confirmation, "PASS signs");
    assert.equal(confirmation.manifest, FIXTURE_EPOCH.anchor.manifestHash);
    assert.ok(verifyCommonsConfirmation(confirmation).ok);
  });

  it("FAIL: mutated JSONL never signs and reports the differing hash", () => {
    const mutated = FIXTURE_EPOCH.jsonl.replace(
      "Example Werke GmbH",
      "Example Werke GmbX",
    );
    assert.notEqual(mutated, FIXTURE_EPOCH.jsonl, "fixture mutation applied");

    const rebuilt = verifyEpochRebuild({
      anchor: FIXTURE_EPOCH.anchor,
      manifestJson: FIXTURE_EPOCH.manifest,
      jsonlText: mutated,
    });
    assert.ok(!rebuilt.ok);
    const failure = rebuilt.failures.find((f) => f.check === "dataset-jsonl-sha256");
    assert.ok(failure, "jsonl hash mismatch reported");
    assert.equal(failure.expected, FIXTURE_EPOCH.anchor.jsonlSha256);
    assert.ok(failure.got?.startsWith("sha256:"));
    assert.notEqual(failure.got, failure.expected);

    assert.equal(
      signIfRebuilt(rebuilt, FIXTURE_EPOCH.anchor.manifestHash),
      null,
      "FAIL never signs",
    );
  });

  it("FAIL: a tampered manifest breaks both hash and signature checks", () => {
    // Tamper a signed field that still parses (epoch/parent are cross-validated).
    const tampered: Manifest = {
      ...FIXTURE_EPOCH.manifest,
      compiler: { name: "@kargain/vincent-compiler", version: "9.9.9" },
    };
    const rebuilt = verifyEpochRebuild({
      anchor: FIXTURE_EPOCH.anchor,
      manifestJson: tampered,
      jsonlText: FIXTURE_EPOCH.jsonl,
    });
    assert.ok(!rebuilt.ok);
    const checks = rebuilt.failures.map((f) => f.check);
    assert.ok(checks.includes("manifest-hash"));
    assert.ok(checks.includes("manifest-signature"));
    assert.equal(signIfRebuilt(rebuilt, FIXTURE_EPOCH.anchor.manifestHash), null);
  });

  it("FAIL: an anchor pointing at different dataset hashes is reported verbatim", () => {
    const rebuilt = verifyEpochRebuild({
      anchor: {
        ...FIXTURE_EPOCH.anchor,
        jsonlSha256: `sha256:${"11".repeat(32)}`,
        merkleRoot: `sha256:${"22".repeat(32)}`,
      },
      manifestJson: FIXTURE_EPOCH.manifest,
      jsonlText: FIXTURE_EPOCH.jsonl,
    });
    assert.ok(!rebuilt.ok);
    const checks = rebuilt.failures.map((f) => f.check);
    assert.ok(checks.includes("anchor-jsonl-sha256"));
    assert.ok(checks.includes("anchor-merkle-root"));
  });

  it("FAIL: garbage manifest JSON fails closed", () => {
    const rebuilt = verifyEpochRebuild({
      anchor: FIXTURE_EPOCH.anchor,
      manifestJson: { hello: "world" },
      jsonlText: FIXTURE_EPOCH.jsonl,
    });
    assert.ok(!rebuilt.ok);
    assert.equal(rebuilt.failures[0]?.check, "manifest-parse");
  });

  it("FAIL: a JSONL line that is not a claim is rejected with its line number", () => {
    const rebuilt = verifyEpochRebuild({
      anchor: FIXTURE_EPOCH.anchor,
      manifestJson: FIXTURE_EPOCH.manifest,
      jsonlText: FIXTURE_EPOCH.jsonl,
    });
    assert.ok(rebuilt.ok);

    // Same bytes hash gate first: craft a manifest whose dataset hash matches
    // a JSONL with a non-claim line, so the claim parser is what fails.
    const badJsonl = `${FIXTURE_EPOCH.jsonl}{"not":"a claim"}\n`;
    const built = compile(FIXTURE_EPOCH.claims, {});
    assert.ok(built.ok);
    const unsigned: UnsignedManifest = {
      schemaVersion: "1.0",
      epoch: 1,
      parent: null,
      reviewPolicy: {
        minAccepts: 1,
        reviewers: [addressFromPrivateKey(KEY_PUBLISHER)],
      },
      compiler: { name: "@kargain/vincent-compiler", version: "0.1.0" },
      dataset: {
        jsonlSha256: contentIdOf(badJsonl),
        merkleRoot: built.value.merkleRoot,
        uris: ["ar://fixture-dataset"],
      },
    };
    const manifest = signManifest(unsigned, KEY_PUBLISHER);
    const result = verifyEpochRebuild({
      anchor: {
        manifestHash: manifestHash(manifest),
        jsonlSha256: unsigned.dataset.jsonlSha256,
        merkleRoot: unsigned.dataset.merkleRoot,
      },
      manifestJson: manifest,
      jsonlText: badJsonl,
    });
    assert.ok(!result.ok);
    assert.equal(result.failures[0]?.check, "jsonl-claim-parse");
    assert.ok(result.failures[0]?.got?.includes("line 4"));
  });
});
