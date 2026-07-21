import { Options } from "@layerzerolabs/lz-v2-utilities";
import { getAddress, padHex, type Address, type Hex } from "viem";

import {
  requiredLzReceiveGasForUri,
  type LzReceiveGasCapExceeded,
} from "./lz-receive-gas";

/**
 * Build ONFT SendParam for hub→spoke.
 *
 * Pathway enforcedOptions pin type2 SEND_AND_COMPOSE gas at 250k (floor for
 * typical Arweave URIs). Sender `extraOptions` raise Executor lzReceive gas from
 * URI-length policy (`lz-receive-gas.ts`) so long compose payloads do not OOG.
 * Quote and send must use the same SendParam so the fee matches what is sent.
 */
export type BridgeSendParam = {
  dstEid: number;
  to: Hex;
  tokenId: bigint;
  extraOptions: Hex;
  composeMsg: Hex;
  onftCmd: Hex;
};

export type BridgeMessagingFee = {
  nativeFee: bigint;
  lzTokenFee: bigint;
};

export class BridgeUriTooLongError extends Error {
  readonly reason = "exceeds_cap" as const;
  readonly required: number;
  readonly cap: number;

  constructor(result: LzReceiveGasCapExceeded) {
    super(
      `This passport metadata URI is too long to bridge safely (${result.required} gas needed, cap ${result.cap}). Shorten the token URI and try again.`,
    );
    this.name = "BridgeUriTooLongError";
    this.required = result.required;
    this.cap = result.cap;
  }
}

/** Executor lzReceive option hex for the given gas units (value=0). */
export function encodeLzReceiveExtraOptions(gas: number): Hex {
  return Options.newOptions()
    .addExecutorLzReceiveOption(gas, 0)
    .toHex() as Hex;
}

export function buildSendParam(params: {
  dstEid: number;
  recipient: Address;
  tokenId: bigint;
  tokenUri: string;
}): BridgeSendParam {
  const gasResult = requiredLzReceiveGasForUri(params.tokenUri);
  if (!gasResult.ok) {
    throw new BridgeUriTooLongError(gasResult);
  }
  return {
    dstEid: params.dstEid,
    to: padHex(getAddress(params.recipient), { size: 32 }),
    tokenId: params.tokenId,
    extraOptions: encodeLzReceiveExtraOptions(gasResult.gas),
    composeMsg: "0x",
    onftCmd: "0x",
  };
}

export function sendArgs(
  sendParam: BridgeSendParam,
  fee: BridgeMessagingFee,
  refundAddress: Address,
): readonly [BridgeSendParam, BridgeMessagingFee, Address] {
  return [sendParam, fee, getAddress(refundAddress)] as const;
}
