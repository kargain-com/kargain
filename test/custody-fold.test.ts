/**
 * Pure custody fold unit tests (S7c-3).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { foldPassportCustody } from "../lib/custody/fold.js";
import type {
  NormalizedCrossingLeg,
  NormalizedCustodyEvent,
} from "../lib/custody/normalized-event.js";
import { evmWriterOrderKey } from "../lib/custody/writer-order.js";

const HUB = 84532;
const SPOKE = 11155111;
const tokenId = `${BigInt(HUB) << 128n | 7n}`;

function evmEvent(
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

function crossing(
  direction: "sent" | "received",
  chainId: number,
  guid: string,
  block: number,
  log: number,
  peer: number,
): NormalizedCrossingLeg {
  return {
    guid,
    direction,
    tokenId,
    observerNamespace: chainId,
    peerNamespace: peer,
    writerOrderKey: evmWriterOrderKey(chainId, block, log),
  };
}

describe("custody fold", () => {
  it("native mint resolves to origin namespace", () => {
    const result = foldPassportCustody({
      tokenId,
      streamB: [evmEvent(HUB, "native_mint", 1, 0)],
      crossings: [],
    });
    assert.deepEqual(result, { status: "resolved", custodyNamespace: HUB });
  });

  it("home → away → home via bridge + unlock", () => {
    const guidOut = "0x" + "ab".repeat(32);
    const guidBack = "0x" + "ac".repeat(32);
    const result = foldPassportCustody({
      tokenId,
      streamB: [
        evmEvent(HUB, "native_mint", 1, 0),
        evmEvent(SPOKE, "bridge_arrival", 2, 1),
        evmEvent(HUB, "custody_unlock", 4, 0),
      ],
      crossings: [
        crossing("sent", HUB, guidOut, 2, 0, SPOKE),
        crossing("received", SPOKE, guidOut, 2, 1, HUB),
        crossing("sent", SPOKE, guidBack, 3, 0, HUB),
        crossing("received", HUB, guidBack, 3, 1, SPOKE),
      ],
    });
    assert.deepEqual(result, { status: "resolved", custodyNamespace: HUB });
  });

  it("governed recovery unlock on home after guid-linked return", () => {
    const guidOut = "0x" + "ee".repeat(32);
    const guidBack = "0x" + "ef".repeat(32);
    const result = foldPassportCustody({
      tokenId,
      streamB: [
        evmEvent(HUB, "native_mint", 1, 0),
        evmEvent(SPOKE, "bridge_arrival", 2, 1),
        evmEvent(HUB, "custody_unlock", 4, 0),
      ],
      crossings: [
        crossing("sent", HUB, guidOut, 2, 0, SPOKE),
        crossing("received", SPOKE, guidOut, 2, 1, HUB),
        crossing("sent", SPOKE, guidBack, 3, 0, HUB),
        crossing("received", HUB, guidBack, 3, 1, SPOKE),
      ],
    });
    assert.deepEqual(result, { status: "resolved", custodyNamespace: HUB });
  });

  it("departure without arrival is unresolved", () => {
    const guid = "0x" + "cd".repeat(32);
    const result = foldPassportCustody({
      tokenId,
      streamB: [evmEvent(HUB, "native_mint", 1, 0)],
      crossings: [crossing("sent", HUB, guid, 2, 0, SPOKE)],
    });
    assert.deepEqual(result, {
      status: "unresolved",
      cause: "departure_without_arrival",
    });
  });

  it("received without sent is incomplete_crossing_link", () => {
    const guid = "0x" + "ef".repeat(32);
    const result = foldPassportCustody({
      tokenId,
      streamB: [evmEvent(HUB, "native_mint", 1, 0)],
      crossings: [crossing("received", SPOKE, guid, 2, 0, HUB)],
    });
    assert.deepEqual(result, {
      status: "unresolved",
      cause: "incomplete_crossing_link",
    });
  });

  it("unknown namespace fails closed", () => {
    const result = foldPassportCustody({
      tokenId,
      streamB: [evmEvent(99999, "bridge_arrival", 1, 0)],
      crossings: [],
      isRegisteredNamespace: (ns) => ns === HUB || ns === SPOKE,
    });
    assert.deepEqual(result, {
      status: "unresolved",
      cause: "unknown_namespace",
    });
  });

  it("empty history is unresolved", () => {
    const result = foldPassportCustody({
      tokenId,
      streamB: [],
      crossings: [],
    });
    assert.deepEqual(result, { status: "unresolved", cause: "empty_history" });
  });
});
