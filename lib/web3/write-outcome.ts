export type PassportMintedWriteFact =
  | { ok: true; tokenId: string }
  | { ok: false; cause: "missing_minted_passport" };

export type WriteGuid = `0x${string}`;

export type BridgeSendGuidWriteFact =
  | { ok: true; guid: WriteGuid }
  | { ok: false; cause: "missing_bridge_send_guid" };

export type WriteIndexerBarrier =
  | { status: "observed" }
  | { status: "lagging" }
  | { status: "unavailable"; cause: "svm_ingest_unavailable" };

export type WriteOutcome = {
  writeReference: string;
  indexerBarrier: WriteIndexerBarrier;
  claimRecipients: readonly string[];
  mintedPassportTokenId: PassportMintedWriteFact;
  bridgeSendGuid: BridgeSendGuidWriteFact;
};

export function buildWriteOutcome(args: {
  writeReference: string;
  indexerBarrier: WriteIndexerBarrier;
  claimRecipients: readonly string[];
  mintedPassportTokenId: PassportMintedWriteFact;
  bridgeSendGuid: BridgeSendGuidWriteFact;
}): WriteOutcome {
  return {
    writeReference: args.writeReference,
    indexerBarrier: args.indexerBarrier,
    claimRecipients: args.claimRecipients,
    mintedPassportTokenId: args.mintedPassportTokenId,
    bridgeSendGuid: args.bridgeSendGuid,
  };
}

export function writeOutcomeHasClaimRecipient(
  outcome: WriteOutcome,
  address: string,
): boolean {
  return outcome.claimRecipients.includes(address);
}
