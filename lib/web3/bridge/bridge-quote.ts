import type { Address, PublicClient } from "viem";

import { KarPassportBridgeGatewayAbi } from "@/lib/contracts/abis.generated";

import type { BridgeMessagingFee, BridgeSendParam } from "./bridge-send";

/**
 * Quote native fee for gateway `quoteSend` — the only LayerZero ABI surface
 * the UI touches (via generated KarPassportBridgeGateway ABI).
 */
export async function quoteNativeFee(params: {
  publicClient: PublicClient;
  adapter: Address;
  sendParam: BridgeSendParam;
}): Promise<bigint> {
  const fee = (await params.publicClient.readContract({
    address: params.adapter,
    abi: KarPassportBridgeGatewayAbi,
    functionName: "quoteSend",
    args: [params.sendParam, false],
  })) as BridgeMessagingFee;

  return fee.nativeFee;
}

export async function quoteMessagingFee(params: {
  publicClient: PublicClient;
  adapter: Address;
  sendParam: BridgeSendParam;
}): Promise<BridgeMessagingFee> {
  const fee = (await params.publicClient.readContract({
    address: params.adapter,
    abi: KarPassportBridgeGatewayAbi,
    functionName: "quoteSend",
    args: [params.sendParam, false],
  })) as BridgeMessagingFee;

  return {
    nativeFee: fee.nativeFee,
    lzTokenFee: fee.lzTokenFee,
  };
}
