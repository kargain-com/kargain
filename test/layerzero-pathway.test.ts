import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getAddress, zeroAddress } from "viem";

import {
  canonicalizeJson,
  CONFIRMATIONS_FALLBACK,
  EID_HUB,
  EID_SPOKE,
  loadLayerZeroMetadataSnapshot,
  sha256Canonical,
  snapshotWithoutHash,
  type LayerZeroMetadataSnapshot,
} from "../scripts/lib/layerzero-metadata.js";
import {
  ALLOWED_EIDS,
  assertAllowedEid,
  assertLibrariesPinned,
  assertNoDeadDvnInRequired,
  assertReciprocalPeers,
  assertRequiredDvnCount,
  assertTestnetPathway,
  buildEnforcedOptions,
  buildExecutorConfig,
  buildUlnConfig,
  ENFORCED_GAS_SEND,
  ENFORCED_GAS_SEND_AND_COMPOSE,
  EXECUTOR_MAX_MESSAGE_SIZE,
  MSG_TYPE_SEND,
  MSG_TYPE_SEND_AND_COMPOSE,
  remoteEidFor,
  sortAndDedupeAddresses,
  STAR_REMOTE_EID,
} from "../scripts/lib/layerzero-pathway.js";

const A = getAddress("0x000000000000000000000000000000000000000a");
const B = getAddress("0x000000000000000000000000000000000000000b");
const C = getAddress("0x000000000000000000000000000000000000000c");

describe("EID allowlist + star topology", () => {
  it("allows only 40245 and 40161", () => {
    assert.equal(ALLOWED_EIDS.has(EID_HUB), true);
    assert.equal(ALLOWED_EIDS.has(EID_SPOKE), true);
    assert.equal(ALLOWED_EIDS.has(40267), false);
    assert.throws(() => assertAllowedEid(30101), /allowlist/);
  });

  it("maps hub ↔ spoke only", () => {
    assert.equal(STAR_REMOTE_EID[EID_HUB], EID_SPOKE);
    assert.equal(STAR_REMOTE_EID[EID_SPOKE], EID_HUB);
    assert.equal(remoteEidFor(EID_HUB), EID_SPOKE);
    assert.doesNotThrow(() => assertTestnetPathway(EID_HUB, EID_SPOKE));
    assert.doesNotThrow(() => assertTestnetPathway(EID_SPOKE, EID_HUB));
    assert.throws(() => assertTestnetPathway(EID_HUB, EID_HUB), /self-referential|Star/);
  });
});

describe("buildUlnConfig", () => {
  it("sorts and dedupes required DVNs; count === 2; optional empty", () => {
    const cfg = buildUlnConfig({
      confirmations: CONFIRMATIONS_FALLBACK,
      requiredDVNs: [B, A, B],
    });
    assert.equal(cfg.requiredDVNCount, 2);
    assert.equal(cfg.optionalDVNCount, 0);
    assert.equal(cfg.optionalDVNThreshold, 0);
    assert.deepEqual(cfg.optionalDVNs, []);
    assert.deepEqual(cfg.requiredDVNs, sortAndDedupeAddresses([A, B]));
    assert.equal(cfg.confirmations, BigInt(CONFIRMATIONS_FALLBACK));
  });

  it("rejects wrong required count and non-empty optional", () => {
    assert.throws(
      () => buildUlnConfig({ confirmations: 5, requiredDVNs: [A] }),
      /requiredDVNCount must be 2/,
    );
    assert.throws(
      () =>
        buildUlnConfig({
          confirmations: 5,
          requiredDVNs: [A, B],
          optionalDVNs: [C],
        }),
      /optional DVN list must be empty/,
    );
  });
});

describe("buildExecutorConfig + enforcedOptions", () => {
  it("pins maxMessageSize and rejects zero executor", () => {
    const cfg = buildExecutorConfig(A);
    assert.equal(cfg.maxMessageSize, EXECUTOR_MAX_MESSAGE_SIZE);
    assert.equal(cfg.executor, A);
    assert.throws(() => buildExecutorConfig(zeroAddress), /address\(0\)/);
  });

  it("encodes msgType 1 and 2 with expected gas", () => {
    const opts = buildEnforcedOptions(EID_SPOKE);
    assert.equal(opts.length, 2);
    assert.equal(opts[0].msgType, MSG_TYPE_SEND);
    assert.equal(opts[1].msgType, MSG_TYPE_SEND_AND_COMPOSE);
    assert.equal(opts[0].eid, EID_SPOKE);
    assert.match(opts[0].options, /^0x[0-9a-f]+$/i);
    assert.match(opts[1].options, /^0x[0-9a-f]+$/i);
    assert.notEqual(opts[0].options, opts[1].options);
    // Gas constants are the source of the Options encoding.
    assert.equal(ENFORCED_GAS_SEND, 100_000);
    assert.equal(ENFORCED_GAS_SEND_AND_COMPOSE, 250_000);
  });
});

describe("validators", () => {
  it("rejects dead DVN in required set", () => {
    const dead = A;
    assert.deepEqual(assertNoDeadDvnInRequired([B, C], dead), []);
    assert.match(
      assertNoDeadDvnInRequired([A, B], dead)[0] ?? "",
      /dead DVN/,
    );
  });

  it("rejects requiredDVNCount < 2", () => {
    assert.deepEqual(assertRequiredDvnCount(2), []);
    assert.match(assertRequiredDvnCount(1)[0] ?? "", /requiredDVNCount/);
  });

  it("detects default library and mismatched snapshot libs", () => {
    const chain = {
      chainKey: "base-sepolia",
      chainId: 84532 as const,
      eid: EID_HUB,
      endpointV2: A,
      sendUln302: A,
      receiveUln302: B,
      executor: C,
      dvns: {
        "layerzero-labs": A,
        nethermind: B,
        p2p: C,
        horizen: A,
      },
      deadDvn: null,
    };
    const errs = assertLibrariesPinned(chain, {
      sendLibrary: A,
      receiveLibrary: B,
      isDefaultSend: true,
      isDefaultReceive: false,
    });
    assert.ok(errs.some((e) => /default send library/.test(e)));
  });

  it("asserts reciprocal peers", () => {
    assert.deepEqual(
      assertReciprocalPeers({
        hubEid: EID_HUB,
        spokeEid: EID_SPOKE,
        hubOApp: A,
        spokeOApp: B,
      }),
      [],
    );
    assert.ok(
      assertReciprocalPeers({
        hubEid: EID_HUB,
        spokeEid: EID_SPOKE,
        hubOApp: A,
        spokeOApp: A,
      }).some((e) => /must differ/.test(e)),
    );
  });
});

describe("snapshot hash validation", () => {
  it("loadLayerZeroMetadataSnapshot happy path against committed file", () => {
    const snap = loadLayerZeroMetadataSnapshot();
    assert.equal(typeof snap.sha256, "string");
    assert.equal(snap.sha256.length, 64);
    assert.equal(snap.confirmations.source, "explicit-fallback");
    assert.equal(snap.confirmations["40245→40161"], CONFIRMATIONS_FALLBACK);
    const recomputed = sha256Canonical(snapshotWithoutHash(snap));
    assert.equal(recomputed, snap.sha256);
  });

  it("refuses drifted snapshot unless allowDrift", () => {
    const snap = loadLayerZeroMetadataSnapshot();
    const dir = mkdtempSync(join(tmpdir(), "lz-snap-"));
    const path = join(dir, "snapshot.json");
    const drifted: LayerZeroMetadataSnapshot = {
      ...snap,
      sha256: "0".repeat(64),
    };
    writeFileSync(path, `${JSON.stringify(drifted)}\n`);
    assert.throws(
      () => loadLayerZeroMetadataSnapshot({ path }),
      /sha256 drift/,
    );
    assert.doesNotThrow(() =>
      loadLayerZeroMetadataSnapshot({ path, allowDrift: true }),
    );
  });

  it("canonicalizeJson is order-independent for objects", () => {
    assert.equal(
      canonicalizeJson({ b: 1, a: 2 }),
      canonicalizeJson({ a: 2, b: 1 }),
    );
  });
});
