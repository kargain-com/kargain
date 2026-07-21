import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Abi,
  type Log,
} from "viem";

import { KarPassportBridgeGatewayAbi } from "../lib/contracts/abis.generated.ts";
import { onftSentGuidFromLogs } from "../scripts/lib/onft-sent.ts";

describe("onftSentGuidFromLogs", () => {
  it("reads guid from ONFTSent topics", () => {
    const guid =
      "0x93f0463fc0cd85f24087e86d415447e74d56dd3d9f941c54968608b195e11670" as const;
    const fromAddress = "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77" as const;
    const topics = encodeEventTopics({
      abi: KarPassportBridgeGatewayAbi as Abi,
      eventName: "ONFTSent",
      args: { guid, fromAddress },
    });
    const nonIndexed = encodeAbiParameters(
      [{ type: "uint32" }, { type: "uint256" }],
      [40161, 1n],
    );
    const log: Log = {
      address: "0xC219bf834B8965339b95C0B6Afe3c4d0F1266Fb0",
      blockHash: ("0x" + "11".repeat(32)) as `0x${string}`,
      blockNumber: 1n,
      data: nonIndexed,
      logIndex: 0,
      transactionHash: ("0x" + "22".repeat(32)) as `0x${string}`,
      transactionIndex: 0,
      removed: false,
      topics: topics as [`0x${string}`, ...`0x${string}`[]],
    };
    assert.equal(onftSentGuidFromLogs(KarPassportBridgeGatewayAbi as Abi, [log]), guid);
  });

  it("throws when ONFTSent is absent", () => {
    assert.throws(
      () => onftSentGuidFromLogs(KarPassportBridgeGatewayAbi as Abi, []),
      /ONFTSent/,
    );
  });
});
