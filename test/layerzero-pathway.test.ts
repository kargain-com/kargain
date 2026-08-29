import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getAddress, zeroAddress } from "viem";

import {
  canonicalizeJson,
  CONFIRMATIONS_FALLBACK,
  classifyLayerZeroVm,
  EID_HUB,
  EID_SOLANA_DEVNET,
  EID_SPOKE,
  HUB_SOLANA_DEVNET_REQUIRED_DVN_IDS,
  isEvmLayerZeroChain,
  loadLayerZeroMetadataSnapshot,
  pathwayPairKey,
  sha256Canonical,
  SNAPSHOT_PATH,
  snapshotWithoutHash,
  type LayerZeroMetadataSnapshot,
} from "../scripts/lib/layerzero-metadata.js";
import {
  addressToBytes32,
  assertAllowedEid,
  assertLibrariesPinned,
  assertNoDeadDvnInRequired,
  assertReciprocalPeers,
  assertRequiredDvnCount,
  assertStarPathway,
  assertTestnetPathway,
  buildEnforcedOptions,
  buildExecutorConfig,
  buildUlnConfig,
  ENFORCED_GAS_SEND,
  ENFORCED_GAS_SEND_AND_COMPOSE,
  EXECUTOR_MAX_MESSAGE_SIZE,
  isKnownTestnetStarEid,
  MSG_TYPE_SEND,
  MSG_TYPE_SEND_AND_COMPOSE,
  peerToBytes32,
  remoteEidsFor,
  sortAndDedupeAddresses,
} from "../scripts/lib/layerzero-pathway.js";

const A = getAddress("0x000000000000000000000000000000000000000a");
const B = getAddress("0x000000000000000000000000000000000000000b");
const C = getAddress("0x000000000000000000000000000000000000000c");

describe("EID allowlist + star topology", () => {
  it("allows hub and known spokes; refuses Amoy 40267", () => {
    assert.equal(isKnownTestnetStarEid(EID_HUB), true);
    assert.equal(isKnownTestnetStarEid(EID_SPOKE), true);
    assert.equal(isKnownTestnetStarEid(EID_SOLANA_DEVNET), true);
    assert.equal(isKnownTestnetStarEid(40267), false);
    assert.throws(() => assertAllowedEid(30101), /not in the testnet star/);
    assert.throws(() => assertAllowedEid(40267), /not in the testnet star/);
  });

  it("pathway valid iff exactly one end is the hub; spoke↔spoke refused by name", () => {
    assert.deepEqual(remoteEidsFor(EID_HUB, [EID_SPOKE]), [EID_SPOKE]);
    assert.deepEqual(remoteEidsFor(EID_SPOKE, [EID_SPOKE]), [EID_HUB]);
    assert.doesNotThrow(() => assertStarPathway(EID_HUB, EID_SPOKE));
    assert.doesNotThrow(() => assertTestnetPathway(EID_SPOKE, EID_HUB));
    assert.doesNotThrow(() => assertStarPathway(EID_HUB, EID_SOLANA_DEVNET));
    assert.throws(() => assertStarPathway(EID_HUB, EID_HUB), /self-referential/);
    assert.throws(
      () => assertStarPathway(EID_SPOKE, EID_SOLANA_DEVNET),
      /Spoke↔spoke pathway refused/,
    );
  });
});

describe("buildUlnConfig", () => {
  it("sorts and dedupes required DVNs; count follows list; optional empty", () => {
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

  it("allows three required DVNs on testnet; rejects 3–5 violation on mainnet", () => {
    const three = buildUlnConfig({
      confirmations: 5,
      requiredDVNs: [A, B, C],
    });
    assert.equal(three.requiredDVNCount, 3);
    assert.throws(
      () =>
        buildUlnConfig({
          confirmations: 5,
          requiredDVNs: [A, B],
          environment: "mainnet",
        }),
      /3–5 on mainnet/,
    );
    const main = buildUlnConfig({
      confirmations: 15,
      requiredDVNs: [A, B, C],
      environment: "mainnet",
    });
    assert.equal(main.requiredDVNCount, 3);
  });

  it("rejects too few required and non-empty optional", () => {
    assert.throws(
      () => buildUlnConfig({ confirmations: 5, requiredDVNs: [A] }),
      /at least 2 on testnet/,
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
      chainId: 84532,
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

  it("encodes SVM peer as raw 32-byte pubkey (not EVM left-pad)", () => {
    const gateway = "ELNhPxSsCh2fdfndMNAjCtdmKDhcCsSezXzdgARNwWre";
    const peer = peerToBytes32(EID_SOLANA_DEVNET, gateway);
    assert.match(peer, /^0x[0-9a-f]{64}$/);
    assert.notEqual(peer.slice(0, 26), `0x${"00".repeat(12)}`);
    assert.equal(peerToBytes32(EID_SPOKE, A), addressToBytes32(A));
  });
});

describe("snapshot hash validation", () => {
  it("loadLayerZeroMetadataSnapshot happy path against committed file", () => {
    const snap = loadLayerZeroMetadataSnapshot();
    assert.equal(typeof snap.sha256, "string");
    assert.equal(snap.sha256.length, 64);
    const stored = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as {
      sha256: string;
    } & Record<string, unknown>;
    const { sha256, ...rest } = stored;
    assert.equal(sha256Canonical(rest), sha256);
    assert.equal(snap.sha256, sha256);
    const live = snap.pathways[pathwayPairKey(EID_HUB, EID_SPOKE)];
    assert.ok(live);
    assert.equal(live.source, "explicit-fallback");
    assert.equal(live.confirmations["40245→40161"], CONFIRMATIONS_FALLBACK);
  });

  it("refuses drifted snapshot unless allowDrift", () => {
    const snap = loadLayerZeroMetadataSnapshot();
    const dir = mkdtempSync(join(tmpdir(), "lz-snap-"));
    const path = join(dir, "snapshot.json");
    const { pathways: _p, ...fileShaped } = snap;
    const drifted: LayerZeroMetadataSnapshot = {
      ...fileShaped,
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

describe("star snapshot 40168 SVM row", () => {
  it("EVM 40245/40161 objects stay field-identical to the July pin", () => {
    const snap = loadLayerZeroMetadataSnapshot();
    const hub = snap.chains[EID_HUB];
    const spoke = snap.chains[EID_SPOKE];
    assert.ok(hub && isEvmLayerZeroChain(hub));
    assert.ok(spoke && isEvmLayerZeroChain(spoke));
    assert.equal(hub.endpointV2, "0x6EDCE65403992e310A62460808c4b910D972f10f");
    assert.equal(spoke.endpointV2, "0x6EDCE65403992e310A62460808c4b910D972f10f");
    assert.equal(hub.dvns["layerzero-labs"], "0xe1a12515F9AB2764b887bF60B923Ca494EBbB2d6");
    assert.equal(spoke.dvns.nethermind, "0x68802e01D6321D5159208478f297d7007A7516Ed");
    assert.ok(!("vm" in hub) || (hub as { vm?: string }).vm !== "svm");
  });

  it("has no top-level confirmations dual; pathways own confirmations", () => {
    const stored = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal("confirmations" in stored, false);
    const snap = loadLayerZeroMetadataSnapshot();
    assert.equal(
      "confirmations" in (snap as unknown as Record<string, unknown>),
      false,
    );
    const live = snap.pathways[pathwayPairKey(EID_HUB, EID_SPOKE)];
    assert.ok(live);
    assert.equal(live.confirmations["40245→40161"], CONFIRMATIONS_FALLBACK);
  });

  it("40168 is SVM base58; required pair is labs+p2p; confirmations explicit-fallback", () => {
    const snap = loadLayerZeroMetadataSnapshot();
    const svm = snap.chains[EID_SOLANA_DEVNET];
    assert.ok(svm);
    assert.equal(isEvmLayerZeroChain(svm), false);
    assert.equal(svm.vm, "svm");
    assert.doesNotMatch(svm.endpointV2, /^0x/i);
    assert.doesNotMatch(svm.dvns["layerzero-labs"] ?? "", /^0x/i);
    const rec = snap.pathways[pathwayPairKey(EID_HUB, EID_SOLANA_DEVNET)];
    assert.ok(rec);
    assert.deepEqual(rec.requiredDvnIds, [...HUB_SOLANA_DEVNET_REQUIRED_DVN_IDS]);
    assert.notDeepEqual(rec.requiredDvnIds, ["layerzero-labs", "nethermind"]);
    assert.equal(rec.source, "explicit-fallback");
    assert.equal(rec.confirmations["40245→40168"], CONFIRMATIONS_FALLBACK);
    assert.equal(rec.confirmations["40168→40245"], CONFIRMATIONS_FALLBACK);
  });

  it("SVM snapshot normalize does not call getAddress", () => {
    const src = readFileSync(
      join(process.cwd(), "scripts/lib/layerzero-metadata.ts"),
      "utf8",
    );
    const match = src.match(/function svmAddr\([\s\S]*?\n\}/);
    assert.ok(match);
    assert.doesNotMatch(match[0], /getAddress/);
    assert.match(match[0], /normalizeProtocolAddressForVm\(\s*"svm"/);
  });
});

describe("classifyLayerZeroVm", () => {
  it("missing vm or evm → EVM; svm → SVM; unknown → named refusal", () => {
    assert.equal(classifyLayerZeroVm({}), "evm");
    assert.equal(classifyLayerZeroVm({ vm: "evm" }), "evm");
    assert.equal(classifyLayerZeroVm({ vm: "svm" }), "svm");
    assert.throws(
      () => classifyLayerZeroVm({ vm: "aptos" }),
      /Unknown LayerZero chain vm: aptos/,
    );
  });
});
