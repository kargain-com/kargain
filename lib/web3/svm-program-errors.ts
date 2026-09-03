/**
 * Sole ordinal → program error-name map for SVM (S8-3).
 * Generated from svm/crates/kargain-errors — names match Solidity where shared;
 * D-43: ordinal carries no parameters; UI copy is name-only via REVERT_COPY.
 */

export const SVM_PROGRAM_ERROR_BY_ORDINAL = [
  "NonexistentToken", // 0
  "NotOwner", // 1
  "NotActiveVerifier", // 2
  "CannotSelfVerify", // 3
  "InvalidStatus", // 4
  "EmptyField", // 5
  "ZeroAddress", // 6
  "ZeroDisputeDeposit", // 7
  "SameURI", // 8
  "NothingToRescue", // 9
  "TokenIdSpaceExhausted", // 10
  "GatewayAlreadySet", // 11
  "NotBridgeGateway", // 12
  "NotForeignToken", // 13
  "NotHomeToken", // 14
  "TokenExists", // 15
  "PassportBridgedAway", // 16
  "SourceAlreadyRegistered", // 17
  "SourceNotRegistered", // 18
  "TooManyEncumbranceSources", // 19
  "SourceUnanswerable", // 20
  "DisputeActive", // 21
  "NoActiveDispute", // 22
  "NotDisputeOpener", // 23
  "DisputeWindowElapsed", // 24
  "DisputeWindowActive", // 25
  "CannotResolveOwnDispute", // 26
  "WrongValue", // 27
  "NotEligibleChallenger", // 28
  "NotQualifiedJudge", // 29
  "CannotRouteBondToJudge", // 30
  "ZeroForfeitRecipient", // 31
  "ZeroChallengeWindow", // 32
  "ChallengeAlreadyConfigured", // 33
  "ChallengeNotConfigured", // 34
  "NoClaim", // 35
  "TransferFailed", // 36
  "LeaveChainRefused", // 37
  "NotRepresentationOwner", // 38
  "NotLocked", // 39
  "ComposeRequired", // 40
  "ComposeUndecodable", // 41
  "UriTooLong", // 42
  "UriExceedsBridgeCeiling", // 43
  "BelowMinStake", // 44
  "AlreadyVerifier", // 45
  "UnbondPending", // 46
  "NotVerifier", // 47
  "UnbondNotReady", // 48
  "NoUnbond", // 49
  "BelowMinStakeFloor", // 50
  "OnlyStaking", // 51
  "AlreadyHoldsPass", // 52
  "DoesNotHoldPass", // 53
  "Soulbound", // 54
  "NotHolder", // 55
  "InvalidCategory", // 56
  "BelowFloor", // 57
  "ShortDelivery", // 58
  "TokenHasNoCode", // 59
  "TokenNonConforming", // 60
  "TokenDecimalsUnavailable", // 61
  "ArithmeticOverflow", // 62
  "WrongPlatformRecipient", // 63
  "MissingPlatformRecipient", // 64
  "WrongSellerRecipient", // 65
  "MissingSellerRecipient", // 66
  "WrongAgentRecipient", // 67
  "MissingAgentRecipient", // 68
  "TransferFeeExtensionForbidden", // 69
  "OpenConsignmentRefused", // 70
  "ModeNotEncumbranceSource", // 71
  "NotOffered", // 72
  "NotDirectConsignment", // 73
  "FeeTooHigh", // 74
  "NotConsignmentRunner", // 75
  "ContractPaused", // 76
  "NotGuardian", // 77
  "NotGuardianOrOwner", // 78
  "NotPassportOwner", // 79
  "LiveConsignment", // 80
  "NoLiveConsignment", // 81
  "EscrowNotApproved", // 82
  "MandateExpired", // 83
  "NoMandate", // 84
  "DenominationMismatch", // 85
  "CannotRaiseFloor", // 86
  "CannotRaiseCommission", // 87
  "NotCommissionForm", // 88
  "NotConsignmentAgent", // 89
  "NotConsignmentSeller", // 90
  "NotOfferedAgented", // 91
  "ReturnAlreadyRequested", // 92
  "ReturnNotRequested", // 93
  "ReturnCooldownPending", // 94
  "AscendingOpenPath", // 95
  "TermsFixed", // 96
  "PaymentTokenNotSupported", // 97
  "EmptySettlementNote", // 98
  "NotSellerOrAgent", // 99
  "DirectEthNotAccepted", // 100
  "FiatDenominationRefused", // 101
  "BadDuration", // 102
  "ProtectionOutOfBounds", // 103
  "BadConfig", // 104
  "BadReserve", // 105
  "BidFromSeller", // 106
  "BidFromAgent", // 107
  "BidTooLow", // 108
  "NotBinding", // 109
  "AuctionEnded", // 110
  "AuctionNotEnded", // 111
  "NoHold", // 112
  "HoldNotReady", // 113
  "NotHoldBuyer", // 114
  "ReversalPending", // 115
  "NoReversalPending", // 116
  "AbandonmentNotReady", // 117
  "ProtectionElapsed", // 118
  "SettlementPending", // 119
  "NotPassportHolder", // 120
  "PassportNotVerified", // 121
  "StalePrice", // 122
  "BadOracleAnswer", // 123
  "PaymentTokenFeedRequired", // 124
  "CannotClearPaymentTokenFeed", // 125
  "ZeroFeedStaleness", // 126
  "StalenessWithoutFeed", // 127
  "FeedStalenessOutOfBounds", // 128
  "InvalidFeed", // 129
  "InvalidFeedDecimals", // 130
  "ConfidenceTooWide", // 131
  "InvalidCurrencyCode", // 132
  "CurrencyNotAvailableOnChain", // 133
] as const;

export type SvmProgramErrorName = (typeof SVM_PROGRAM_ERROR_BY_ORDINAL)[number];

/** Resolve a custom-program error ordinal to its shared error name. */
export function svmProgramErrorName(ordinal: number): SvmProgramErrorName | null {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= SVM_PROGRAM_ERROR_BY_ORDINAL.length) {
    return null;
  }
  return SVM_PROGRAM_ERROR_BY_ORDINAL[ordinal]!;
}

