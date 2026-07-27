/** Pure G1 trust-field updates shared by Ponder handlers and unit tests. */

export function nextVerificationResetCount(current: number): number {
  return current + 1;
}

export function passportMintTrustFields(timestamp: bigint) {
  return {
    lastMetadataChangeAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function passportDisputedTrustFields(timestamp: bigint) {
  return {
    status: "DISPUTED" as const,
    disputeWithdrawnAt: 0n,
    disputeOpenedAt: timestamp,
    hadDispute: true,
    updatedAt: timestamp,
  };
}

/** RejectDispute (1) upholds verification; ConfirmDispute (0) clears it. */
export function disputeOutcomeUpholdsVerification(outcome: number): boolean {
  return outcome === 1;
}

export function disputeWithdrawnTrustFields(timestamp: bigint) {
  return {
    status: "VERIFIED" as const,
    disputeWithdrawnAt: timestamp,
    disputeOpenedAt: 0n,
    disputeDeposit: null,
    updatedAt: timestamp,
  };
}

export function disputeResolvedTrustFields(uphold: boolean, timestamp: bigint) {
  const resolved = {
    lastDisputeResolvedAt: timestamp,
    disputeOpenedAt: 0n,
    disputeDeposit: null,
    updatedAt: timestamp,
  };
  if (uphold) {
    return { status: "VERIFIED" as const, ...resolved };
  }
  return {
    status: "UNVERIFIED" as const,
    verifier: "",
    verifiedAt: 0n,
    ...resolved,
  };
}

/**
 * Destination representation arrival (PassportBridgeMinted).
 * Usable-instance trust is UNVERIFIED; does **not** project VerificationReset
 * accounting (count / lastVerificationResetAt) — that event is unlock / URI-edit only.
 */
export function bridgeMintArrivalTrustFields(timestamp: bigint) {
  return {
    status: "UNVERIFIED" as const,
    verifier: "",
    verifiedAt: 0n,
    lastMetadataChangeAt: timestamp,
    updatedAt: timestamp,
  };
}

export function verificationResetTrustFields(existingCount: number, timestamp: bigint) {
  return {
    status: "UNVERIFIED" as const,
    verifier: "",
    verifiedAt: 0n,
    lastVerificationResetAt: timestamp,
    verificationResetCount: nextVerificationResetCount(existingCount),
    updatedAt: timestamp,
  };
}

export function passportUriUpdatedTrustFields(timestamp: bigint) {
  return {
    lastMetadataChangeAt: timestamp,
    updatedAt: timestamp,
  };
}

/** hadDispute is write-once; resolution must not clear it. */
export function hadDisputeAfterResolve(previousHadDispute: boolean): boolean {
  return previousHadDispute;
}
