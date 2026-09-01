/**
 * KarPassportBridgeGateway Ponder handlers — sole `bridge_crossing` inserts
 * from gateway events (S7b). Passport custody handlers stay in src/index.ts.
 */

import { ponder } from "ponder:registry";
import { getAddress } from "viem";

import {
  insertOnftReceivedCrossing,
  insertOnftSentCrossing,
  type BridgeCrossingContext,
} from "./lib/ponder-bridge-crossings";

function indexingChainId(context: { chain: { id: number } }): number {
  return Number(context.chain.id);
}

ponder.on("KarPassportBridgeGateway:ONFTSent", async ({ event, context }) => {
  await insertOnftSentCrossing(context as BridgeCrossingContext, {
    observingChainId: indexingChainId(context),
    guid: event.args.guid,
    dstEid: Number(event.args.dstEid),
    fromAddress: getAddress(event.args.fromAddress),
    tokenId: event.args.tokenId.toString(),
    blockNumber: Number(event.block.number),
    logIndex: event.log.logIndex,
    txHash: event.transaction.hash,
    timestamp: event.block.timestamp,
  });
});

ponder.on("KarPassportBridgeGateway:ONFTReceived", async ({ event, context }) => {
  await insertOnftReceivedCrossing(context as BridgeCrossingContext, {
    observingChainId: indexingChainId(context),
    guid: event.args.guid,
    srcEid: Number(event.args.srcEid),
    toAddress: getAddress(event.args.toAddress),
    tokenId: event.args.tokenId.toString(),
    blockNumber: Number(event.block.number),
    logIndex: event.log.logIndex,
    txHash: event.transaction.hash,
    timestamp: event.block.timestamp,
  });
});
