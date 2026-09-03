/**
 * KarPassportBridgeGateway Ponder handlers — sole `bridge_crossing` inserts
 * from gateway events (S7b). Passport custody handlers stay in src/index.ts.
 */

import { getAddress } from "viem";

import {
  insertOnftReceivedCrossing,
  insertOnftSentCrossing,
} from "./lib/ponder-bridge-crossings";
import {
  eventArgs,
  onOptionalContractEvent,
} from "./lib/ponder-optional-contract-on";

function indexingChainId(context: { chain: { id: number } }): number {
  return Number(context.chain.id);
}

type OnftSentArgs = {
  guid: `0x${string}`;
  dstEid: number | bigint;
  fromAddress: `0x${string}`;
  tokenId: bigint;
};

type OnftReceivedArgs = {
  guid: `0x${string}`;
  srcEid: number | bigint;
  toAddress: `0x${string}`;
  tokenId: bigint;
};

onOptionalContractEvent("KarPassportBridgeGateway:ONFTSent", async ({ event, context }) => {
  const args = eventArgs<OnftSentArgs>(event);
  await insertOnftSentCrossing(context, {
    observingChainId: indexingChainId(context),
    guid: args.guid,
    dstEid: Number(args.dstEid),
    fromAddress: getAddress(args.fromAddress),
    tokenId: args.tokenId.toString(),
    blockNumber: Number(event.block.number),
    logIndex: event.log.logIndex,
    txHash: event.transaction.hash,
    timestamp: event.block.timestamp,
  });
});

onOptionalContractEvent(
  "KarPassportBridgeGateway:ONFTReceived",
  async ({ event, context }) => {
    const args = eventArgs<OnftReceivedArgs>(event);
    await insertOnftReceivedCrossing(context, {
      observingChainId: indexingChainId(context),
      guid: args.guid,
      srcEid: Number(args.srcEid),
      toAddress: getAddress(args.toAddress),
      tokenId: args.tokenId.toString(),
      blockNumber: Number(event.block.number),
      logIndex: event.log.logIndex,
      txHash: event.transaction.hash,
      timestamp: event.block.timestamp,
    });
  },
);
