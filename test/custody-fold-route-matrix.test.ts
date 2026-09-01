/**
 * Fixture registry route matrix — expected custody fold outcomes (S7c-3).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { foldPassportCustody } from "../lib/custody/fold.js";
import type {
  NormalizedCrossingLeg,
  NormalizedCustodyEvent,
} from "../lib/custody/normalized-event.js";
import { evmWriterOrderKey } from "../lib/custody/writer-order.js";
import { FIXTURE_NAMESPACE } from "./fixtures/svm-ingest/fixture-block.js";

const HUB = 84532;
const SPOKE = 11155111;

type MatrixCase = {
  name: string;
  tokenId: string;
  streamB: NormalizedCustodyEvent[];
  crossings: NormalizedCrossingLeg[];
  namespaces: number[];
  expected:
    | { status: "resolved"; custodyNamespace: number }
    | { status: "unresolved"; cause: string };
};

function ev(
  tokenId: string,
  chainId: number,
  kind: NormalizedCustodyEvent["kind"],
  block: number,
  log: number,
): NormalizedCustodyEvent {
  return {
    tokenId,
    namespace: chainId,
    kind,
    writerOrderKey: evmWriterOrderKey(chainId, block, log),
  };
}

function x(
  tokenId: string,
  direction: "sent" | "received",
  chainId: number,
  guid: string,
  block: number,
  log: number,
  peer: number | null,
  refusal?: "unknown_endpoint_id",
): NormalizedCrossingLeg {
  return {
    guid,
    direction,
    tokenId,
    observerNamespace: chainId,
    peerNamespace: peer,
    peerNamespaceRefusal: refusal,
    writerOrderKey: evmWriterOrderKey(chainId, block, log),
  };
}

const hubToken = `${BigInt(HUB) << 128n | 42n}`;
const guidA = "0x" + "11".repeat(32);
const guidB = "0x" + "22".repeat(32);
const guidReturn = "0x" + "33".repeat(32);

const REGISTRY: MatrixCase[] = [
  {
    name: "case 1 — hub native mint",
    tokenId: hubToken,
    streamB: [ev(hubToken, HUB, "native_mint", 100, 0)],
    crossings: [],
    namespaces: [HUB, SPOKE, FIXTURE_NAMESPACE],
    expected: { status: "resolved", custodyNamespace: HUB },
  },
  {
    name: "case 2 — round trip hub→spoke→hub",
    tokenId: hubToken,
    streamB: [
      ev(hubToken, HUB, "native_mint", 100, 0),
      ev(hubToken, SPOKE, "bridge_arrival", 200, 1),
      ev(hubToken, HUB, "custody_unlock", 300, 0),
    ],
    crossings: [
      x(hubToken, "sent", HUB, guidA, 200, 0, SPOKE),
      x(hubToken, "received", SPOKE, guidA, 200, 1, HUB),
      x(hubToken, "sent", SPOKE, guidReturn, 250, 0, HUB),
      x(hubToken, "received", HUB, guidReturn, 250, 1, SPOKE),
    ],
    namespaces: [HUB, SPOKE, FIXTURE_NAMESPACE],
    expected: { status: "resolved", custodyNamespace: HUB },
  },
  {
    name: "case 3 — in-flight departure",
    tokenId: hubToken,
    streamB: [ev(hubToken, HUB, "native_mint", 100, 0)],
    crossings: [x(hubToken, "sent", HUB, guidB, 200, 0, SPOKE)],
    namespaces: [HUB, SPOKE, FIXTURE_NAMESPACE],
    expected: { status: "unresolved", cause: "departure_without_arrival" },
  },
  {
    name: "case 4 — FIXTURE_NAMESPACE peer refusal",
    tokenId: hubToken,
    streamB: [ev(hubToken, HUB, "native_mint", 100, 0)],
    crossings: [
      x(hubToken, "sent", HUB, guidB, 200, 0, null, "unknown_endpoint_id"),
    ],
    namespaces: [HUB, SPOKE, FIXTURE_NAMESPACE],
    expected: { status: "unresolved", cause: "unknown_namespace" },
  },
];

describe("custody fold route matrix", () => {
  for (const row of REGISTRY) {
    it(row.name, () => {
      const observed = foldPassportCustody({
        tokenId: row.tokenId,
        streamB: row.streamB,
        crossings: row.crossings,
        isRegisteredNamespace: (ns) => row.namespaces.includes(ns),
      });
      assert.deepEqual(observed, row.expected);
    });
  }

  it("negative control — broken guid link fails case 2", () => {
    const row = REGISTRY[1]!;
    const observed = foldPassportCustody({
      tokenId: row.tokenId,
      streamB: row.streamB,
      crossings: [row.crossings[0]!],
      isRegisteredNamespace: (ns) => row.namespaces.includes(ns),
    });
    assert.notDeepEqual(observed, row.expected);
  });
});
