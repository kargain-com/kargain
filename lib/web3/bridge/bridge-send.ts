import { getAddress, padHex, type Address, type Hex } from "viem";

/**
 * Build ONFT SendParam for hub→spoke.
 *
 * `extraOptions` is empty (`0x`): pathway enforcedOptions already pin type2
 * SEND_AND_COMPOSE gas at 250k on both ends (SPEC §7.4 / I.9.2), which covers
 * typical Arweave token URIs. Long-URI sender-side gas overrides are a follow-up.
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

export function buildSendParam(params: {
  dstEid: number;
  recipient: Address;
  tokenId: bigint;
}): BridgeSendParam {
  return {
    dstEid: params.dstEid,
    to: padHex(getAddress(params.recipient), { size: 32 }),
    tokenId: params.tokenId,
    extraOptions: "0x",
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
