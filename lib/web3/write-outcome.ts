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

/** SVM send result carried into confirm (signature + blockhash lifetime). */
export type SvmWriteSubmission = {
  vm: "svm";
  signature: string;
  lastValidBlockHeight: bigint;
};

/**
 * What `writeFn` returns inside {@link runWriteLifecycle}.
 * EVM = transaction hash; SVM = submission with lifetime height.
 */
export type WriteSubmission = `0x${string}` | SvmWriteSubmission;

export function isSvmWriteSubmission(
  submission: WriteSubmission,
): submission is SvmWriteSubmission {
  return (
    typeof submission === "object" &&
    submission !== null &&
    submission.vm === "svm"
  );
}

export function writeSubmissionReference(submission: WriteSubmission): string {
  return isSvmWriteSubmission(submission)
    ? submission.signature
    : submission;
}

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
