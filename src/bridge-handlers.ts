/**
 * KarPassportBridgeGateway Ponder handlers — sole `bridge_crossing` inserts
 * from gateway events (S7b). Passport custody handlers stay in src/index.ts.
 */

import { getAddress } from "viem";

import {
  insertOnftReceivedCrossing,
  insertOnftSentCrossing,
} from "./lib/ponder-bridge-crossings";
import { onOptionalContractEvent } from "./lib/ponder-optional-contract-on";

function indexingChainId(context: { chain: { id: number } }): number {
  return Number(context.chain.id);
}

onOptionalContractEvent("KarPassportBridgeGateway:ONFTSent", async ({ event, context }) => {
  const { args } = event;
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
    const { args } = event;
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
