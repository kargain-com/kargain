//! Stable Kargain protocol error names and codes.
//!
//! Names must match Solidity custom errors exactly (indexer / UI contract).
//! Codes are explicit and must never be reordered — append only.

use num_enum::{IntoPrimitive, TryFromPrimitive};
use thiserror::Error;

/// Declared passport / bridge URI ceiling (UTF-8 bytes).
/// Sole Rust owner of this literal — must match
/// `lib/web3/declared-uri-ceiling.ts` and `PassportUriCeiling.BYTES`.
pub const PASSPORT_URI_CEILING_BYTES: usize = 160;

/// Stable error codes. Append new variants at the end only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error, IntoPrimitive, TryFromPrimitive)]
#[repr(u32)]
pub enum KargainError {
    // ---- KarPassport ----
    #[error("NonexistentToken")]
    NonexistentToken = 0,
    #[error("NotOwner")]
    NotOwner = 1,
    #[error("NotActiveVerifier")]
    NotActiveVerifier = 2,
    #[error("CannotSelfVerify")]
    CannotSelfVerify = 3,
    #[error("InvalidStatus")]
    InvalidStatus = 4,
    #[error("EmptyField")]
    EmptyField = 5,
    #[error("ZeroAddress")]
    ZeroAddress = 6,
    #[error("ZeroDisputeDeposit")]
    ZeroDisputeDeposit = 7,
    #[error("SameURI")]
    SameURI = 8,
    #[error("NothingToRescue")]
    NothingToRescue = 9,
    #[error("TokenIdSpaceExhausted")]
    TokenIdSpaceExhausted = 10,
    #[error("GatewayAlreadySet")]
    GatewayAlreadySet = 11,
    #[error("NotBridgeGateway")]
    NotBridgeGateway = 12,
    #[error("NotForeignToken")]
    NotForeignToken = 13,
    #[error("NotHomeToken")]
    NotHomeToken = 14,
    #[error("TokenExists")]
    TokenExists = 15,
    #[error("PassportBridgedAway")]
    PassportBridgedAway = 16,
    #[error("SourceAlreadyRegistered")]
    SourceAlreadyRegistered = 17,
    #[error("SourceNotRegistered")]
    SourceNotRegistered = 18,
    #[error("TooManyEncumbranceSources")]
    TooManyEncumbranceSources = 19,
    #[error("SourceUnanswerable")]
    SourceUnanswerable = 20,

    // ---- BondedChallenge ----
    #[error("DisputeActive")]
    DisputeActive = 21,
    #[error("NoActiveDispute")]
    NoActiveDispute = 22,
    #[error("NotDisputeOpener")]
    NotDisputeOpener = 23,
    #[error("DisputeWindowElapsed")]
    DisputeWindowElapsed = 24,
    #[error("DisputeWindowActive")]
    DisputeWindowActive = 25,
    #[error("CannotResolveOwnDispute")]
    CannotResolveOwnDispute = 26,
    #[error("WrongValue")]
    WrongValue = 27,
    #[error("NotEligibleChallenger")]
    NotEligibleChallenger = 28,
    #[error("NotQualifiedJudge")]
    NotQualifiedJudge = 29,
    #[error("CannotRouteBondToJudge")]
    CannotRouteBondToJudge = 30,
    #[error("ZeroForfeitRecipient")]
    ZeroForfeitRecipient = 31,
    #[error("ZeroChallengeWindow")]
    ZeroChallengeWindow = 32,
    #[error("ChallengeAlreadyConfigured")]
    ChallengeAlreadyConfigured = 33,
    #[error("ChallengeNotConfigured")]
    ChallengeNotConfigured = 34,

    // ---- ClaimablePayouts ----
    #[error("NoClaim")]
    NoClaim = 35,
    #[error("TransferFailed")]
    TransferFailed = 36,

    // ---- KarPassportBridgeGateway ----
    #[error("LeaveChainRefused")]
    LeaveChainRefused = 37,
    #[error("NotRepresentationOwner")]
    NotRepresentationOwner = 38,
    #[error("NotLocked")]
    NotLocked = 39,

    // ---- SVM / compose (D-16) ----
    #[error("ComposeRequired")]
    ComposeRequired = 40,
    #[error("ComposeUndecodable")]
    ComposeUndecodable = 41,

    // ---- URI ceiling (Nuclear #6) — append only ----
    #[error("UriTooLong")]
    UriTooLong = 42,
    #[error("UriExceedsBridgeCeiling")]
    UriExceedsBridgeCeiling = 43,

    // ---- KarProStaking / KarProPass (S5) — append only ----
    #[error("BelowMinStake")]
    BelowMinStake = 44,
    #[error("AlreadyVerifier")]
    AlreadyVerifier = 45,
    #[error("UnbondPending")]
    UnbondPending = 46,
    #[error("NotVerifier")]
    NotVerifier = 47,
    #[error("UnbondNotReady")]
    UnbondNotReady = 48,
    #[error("NoUnbond")]
    NoUnbond = 49,
    #[error("BelowMinStakeFloor")]
    BelowMinStakeFloor = 50,
    #[error("OnlyStaking")]
    OnlyStaking = 51,
    #[error("AlreadyHoldsPass")]
    AlreadyHoldsPass = 52,
    #[error("DoesNotHoldPass")]
    DoesNotHoldPass = 53,
    #[error("Soulbound")]
    Soulbound = 54,
    #[error("NotHolder")]
    NotHolder = 55,
    #[error("InvalidCategory")]
    InvalidCategory = 56,

    // ---- S6 money / commerce mirrors + SVM-only recipient supply (append only) ----
    #[error("BelowFloor")]
    BelowFloor = 57,
    #[error("ShortDelivery")]
    ShortDelivery = 58,
    #[error("TokenHasNoCode")]
    TokenHasNoCode = 59,
    #[error("TokenNonConforming")]
    TokenNonConforming = 60,
    #[error("TokenDecimalsUnavailable")]
    TokenDecimalsUnavailable = 61,
    #[error("ArithmeticOverflow")]
    ArithmeticOverflow = 62,
    #[error("WrongPlatformRecipient")]
    WrongPlatformRecipient = 63,
    #[error("MissingPlatformRecipient")]
    MissingPlatformRecipient = 64,
    #[error("WrongSellerRecipient")]
    WrongSellerRecipient = 65,
    #[error("MissingSellerRecipient")]
    MissingSellerRecipient = 66,
    #[error("WrongAgentRecipient")]
    WrongAgentRecipient = 67,
    #[error("MissingAgentRecipient")]
    MissingAgentRecipient = 68,
    #[error("TransferFeeExtensionForbidden")]
    TransferFeeExtensionForbidden = 69,

    // ---- S6 #2 consignment automaton (Mandate / Recall / ConsignmentBase) — append only ----
    #[error("OpenConsignmentRefused")]
    OpenConsignmentRefused = 70,
    #[error("ModeNotEncumbranceSource")]
    ModeNotEncumbranceSource = 71,
    #[error("NotOffered")]
    NotOffered = 72,
    #[error("NotDirectConsignment")]
    NotDirectConsignment = 73,
    #[error("FeeTooHigh")]
    FeeTooHigh = 74,
    #[error("NotConsignmentRunner")]
    NotConsignmentRunner = 75,
    #[error("ContractPaused")]
    ContractPaused = 76,
    #[error("NotGuardian")]
    NotGuardian = 77,
    #[error("NotGuardianOrOwner")]
    NotGuardianOrOwner = 78,
    #[error("NotPassportOwner")]
    NotPassportOwner = 79,
    #[error("LiveConsignment")]
    LiveConsignment = 80,
    #[error("NoLiveConsignment")]
    NoLiveConsignment = 81,
    #[error("EscrowNotApproved")]
    EscrowNotApproved = 82,
    #[error("MandateExpired")]
    MandateExpired = 83,
    #[error("NoMandate")]
    NoMandate = 84,
    #[error("DenominationMismatch")]
    DenominationMismatch = 85,
    #[error("CannotRaiseFloor")]
    CannotRaiseFloor = 86,
    #[error("CannotRaiseCommission")]
    CannotRaiseCommission = 87,
    #[error("NotCommissionForm")]
    NotCommissionForm = 88,
    #[error("NotConsignmentAgent")]
    NotConsignmentAgent = 89,
    #[error("NotConsignmentSeller")]
    NotConsignmentSeller = 90,
    #[error("NotOfferedAgented")]
    NotOfferedAgented = 91,
    #[error("ReturnAlreadyRequested")]
    ReturnAlreadyRequested = 92,
    #[error("ReturnNotRequested")]
    ReturnNotRequested = 93,
    #[error("ReturnCooldownPending")]
    ReturnCooldownPending = 94,
    /// Mode refuses the shared open signature (Ascending).
    #[error("AscendingOpenPath")]
    AscendingOpenPath = 95,
    /// Mode refuses setPrice (Ascending C4).
    #[error("TermsFixed")]
    TermsFixed = 96,

    // ---- S6 #3b FixedPrice asset-only (append only) ----
    #[error("PaymentTokenNotSupported")]
    PaymentTokenNotSupported = 97,
    #[error("EmptySettlementNote")]
    EmptySettlementNote = 98,
    #[error("NotSellerOrAgent")]
    NotSellerOrAgent = 99,
    #[error("DirectEthNotAccepted")]
    DirectEthNotAccepted = 100,
    /// Ascending (and oracle-banned modes): Fiat denomination refused.
    #[error("FiatDenominationRefused")]
    FiatDenominationRefused = 101,

    // ---- S6 #4 Ascending mode (append only) ----
    #[error("BadDuration")]
    BadDuration = 102,
    #[error("ProtectionOutOfBounds")]
    ProtectionOutOfBounds = 103,
    #[error("BadConfig")]
    BadConfig = 104,
    #[error("BadReserve")]
    BadReserve = 105,
    #[error("BidFromSeller")]
    BidFromSeller = 106,
    #[error("BidFromAgent")]
    BidFromAgent = 107,
    #[error("BidTooLow")]
    BidTooLow = 108,
    #[error("NotBinding")]
    NotBinding = 109,
    #[error("AuctionEnded")]
    AuctionEnded = 110,
    #[error("AuctionNotEnded")]
    AuctionNotEnded = 111,
    #[error("NoHold")]
    NoHold = 112,
    #[error("HoldNotReady")]
    HoldNotReady = 113,
    #[error("NotHoldBuyer")]
    NotHoldBuyer = 114,
    #[error("ReversalPending")]
    ReversalPending = 115,
    #[error("NoReversalPending")]
    NoReversalPending = 116,
    #[error("AbandonmentNotReady")]
    AbandonmentNotReady = 117,
    #[error("ProtectionElapsed")]
    ProtectionElapsed = 118,
    #[error("SettlementPending")]
    SettlementPending = 119,
    #[error("NotPassportHolder")]
    NotPassportHolder = 120,
    #[error("PassportNotVerified")]
    PassportNotVerified = 121,

    // ---- S6 #5 FixedPrice fiat / oracle (append only) ----
    #[error("StalePrice")]
    StalePrice = 122,
    #[error("BadOracleAnswer")]
    BadOracleAnswer = 123,
    #[error("PaymentTokenFeedRequired")]
    PaymentTokenFeedRequired = 124,
    #[error("CannotClearPaymentTokenFeed")]
    CannotClearPaymentTokenFeed = 125,
    #[error("ZeroFeedStaleness")]
    ZeroFeedStaleness = 126,
    #[error("StalenessWithoutFeed")]
    StalenessWithoutFeed = 127,
    #[error("FeedStalenessOutOfBounds")]
    FeedStalenessOutOfBounds = 128,
    #[error("InvalidFeed")]
    InvalidFeed = 129,
    #[error("InvalidFeedDecimals")]
    InvalidFeedDecimals = 130,
    /// D-07 — SVM-only named confidence bound (not folded into StalePrice).
    #[error("ConfidenceTooWide")]
    ConfidenceTooWide = 131,
    #[error("InvalidCurrencyCode")]
    InvalidCurrencyCode = 132,
    #[error("CurrencyNotAvailableOnChain")]
    CurrencyNotAvailableOnChain = 133,
}

impl KargainError {
    /// Stable English name — must equal the Solidity error identifier.
    pub const fn name(self) -> &'static str {
        match self {
            Self::NonexistentToken => "NonexistentToken",
            Self::NotOwner => "NotOwner",
            Self::NotActiveVerifier => "NotActiveVerifier",
            Self::CannotSelfVerify => "CannotSelfVerify",
            Self::InvalidStatus => "InvalidStatus",
            Self::EmptyField => "EmptyField",
            Self::ZeroAddress => "ZeroAddress",
            Self::ZeroDisputeDeposit => "ZeroDisputeDeposit",
            Self::SameURI => "SameURI",
            Self::NothingToRescue => "NothingToRescue",
            Self::TokenIdSpaceExhausted => "TokenIdSpaceExhausted",
            Self::GatewayAlreadySet => "GatewayAlreadySet",
            Self::NotBridgeGateway => "NotBridgeGateway",
            Self::NotForeignToken => "NotForeignToken",
            Self::NotHomeToken => "NotHomeToken",
            Self::TokenExists => "TokenExists",
            Self::PassportBridgedAway => "PassportBridgedAway",
            Self::SourceAlreadyRegistered => "SourceAlreadyRegistered",
            Self::SourceNotRegistered => "SourceNotRegistered",
            Self::TooManyEncumbranceSources => "TooManyEncumbranceSources",
            Self::SourceUnanswerable => "SourceUnanswerable",
            Self::DisputeActive => "DisputeActive",
            Self::NoActiveDispute => "NoActiveDispute",
            Self::NotDisputeOpener => "NotDisputeOpener",
            Self::DisputeWindowElapsed => "DisputeWindowElapsed",
            Self::DisputeWindowActive => "DisputeWindowActive",
            Self::CannotResolveOwnDispute => "CannotResolveOwnDispute",
            Self::WrongValue => "WrongValue",
            Self::NotEligibleChallenger => "NotEligibleChallenger",
            Self::NotQualifiedJudge => "NotQualifiedJudge",
            Self::CannotRouteBondToJudge => "CannotRouteBondToJudge",
            Self::ZeroForfeitRecipient => "ZeroForfeitRecipient",
            Self::ZeroChallengeWindow => "ZeroChallengeWindow",
            Self::ChallengeAlreadyConfigured => "ChallengeAlreadyConfigured",
            Self::ChallengeNotConfigured => "ChallengeNotConfigured",
            Self::NoClaim => "NoClaim",
            Self::TransferFailed => "TransferFailed",
            Self::LeaveChainRefused => "LeaveChainRefused",
            Self::NotRepresentationOwner => "NotRepresentationOwner",
            Self::NotLocked => "NotLocked",
            Self::ComposeRequired => "ComposeRequired",
            Self::ComposeUndecodable => "ComposeUndecodable",
            Self::UriTooLong => "UriTooLong",
            Self::UriExceedsBridgeCeiling => "UriExceedsBridgeCeiling",
            Self::BelowMinStake => "BelowMinStake",
            Self::AlreadyVerifier => "AlreadyVerifier",
            Self::UnbondPending => "UnbondPending",
            Self::NotVerifier => "NotVerifier",
            Self::UnbondNotReady => "UnbondNotReady",
            Self::NoUnbond => "NoUnbond",
            Self::BelowMinStakeFloor => "BelowMinStakeFloor",
            Self::OnlyStaking => "OnlyStaking",
            Self::AlreadyHoldsPass => "AlreadyHoldsPass",
            Self::DoesNotHoldPass => "DoesNotHoldPass",
            Self::Soulbound => "Soulbound",
            Self::NotHolder => "NotHolder",
            Self::InvalidCategory => "InvalidCategory",
            Self::BelowFloor => "BelowFloor",
            Self::ShortDelivery => "ShortDelivery",
            Self::TokenHasNoCode => "TokenHasNoCode",
            Self::TokenNonConforming => "TokenNonConforming",
            Self::TokenDecimalsUnavailable => "TokenDecimalsUnavailable",
            Self::ArithmeticOverflow => "ArithmeticOverflow",
            Self::WrongPlatformRecipient => "WrongPlatformRecipient",
            Self::MissingPlatformRecipient => "MissingPlatformRecipient",
            Self::WrongSellerRecipient => "WrongSellerRecipient",
            Self::MissingSellerRecipient => "MissingSellerRecipient",
            Self::WrongAgentRecipient => "WrongAgentRecipient",
            Self::MissingAgentRecipient => "MissingAgentRecipient",
            Self::TransferFeeExtensionForbidden => "TransferFeeExtensionForbidden",
            Self::OpenConsignmentRefused => "OpenConsignmentRefused",
            Self::ModeNotEncumbranceSource => "ModeNotEncumbranceSource",
            Self::NotOffered => "NotOffered",
            Self::NotDirectConsignment => "NotDirectConsignment",
            Self::FeeTooHigh => "FeeTooHigh",
            Self::NotConsignmentRunner => "NotConsignmentRunner",
            Self::ContractPaused => "ContractPaused",
            Self::NotGuardian => "NotGuardian",
            Self::NotGuardianOrOwner => "NotGuardianOrOwner",
            Self::NotPassportOwner => "NotPassportOwner",
            Self::LiveConsignment => "LiveConsignment",
            Self::NoLiveConsignment => "NoLiveConsignment",
            Self::EscrowNotApproved => "EscrowNotApproved",
            Self::MandateExpired => "MandateExpired",
            Self::NoMandate => "NoMandate",
            Self::DenominationMismatch => "DenominationMismatch",
            Self::CannotRaiseFloor => "CannotRaiseFloor",
            Self::CannotRaiseCommission => "CannotRaiseCommission",
            Self::NotCommissionForm => "NotCommissionForm",
            Self::NotConsignmentAgent => "NotConsignmentAgent",
            Self::NotConsignmentSeller => "NotConsignmentSeller",
            Self::NotOfferedAgented => "NotOfferedAgented",
            Self::ReturnAlreadyRequested => "ReturnAlreadyRequested",
            Self::ReturnNotRequested => "ReturnNotRequested",
            Self::ReturnCooldownPending => "ReturnCooldownPending",
            Self::AscendingOpenPath => "AscendingOpenPath",
            Self::TermsFixed => "TermsFixed",
            Self::PaymentTokenNotSupported => "PaymentTokenNotSupported",
            Self::EmptySettlementNote => "EmptySettlementNote",
            Self::NotSellerOrAgent => "NotSellerOrAgent",
            Self::DirectEthNotAccepted => "DirectEthNotAccepted",
            Self::FiatDenominationRefused => "FiatDenominationRefused",
            Self::BadDuration => "BadDuration",
            Self::ProtectionOutOfBounds => "ProtectionOutOfBounds",
            Self::BadConfig => "BadConfig",
            Self::BadReserve => "BadReserve",
            Self::BidFromSeller => "BidFromSeller",
            Self::BidFromAgent => "BidFromAgent",
            Self::BidTooLow => "BidTooLow",
            Self::NotBinding => "NotBinding",
            Self::AuctionEnded => "AuctionEnded",
            Self::AuctionNotEnded => "AuctionNotEnded",
            Self::NoHold => "NoHold",
            Self::HoldNotReady => "HoldNotReady",
            Self::NotHoldBuyer => "NotHoldBuyer",
            Self::ReversalPending => "ReversalPending",
            Self::NoReversalPending => "NoReversalPending",
            Self::AbandonmentNotReady => "AbandonmentNotReady",
            Self::ProtectionElapsed => "ProtectionElapsed",
            Self::SettlementPending => "SettlementPending",
            Self::NotPassportHolder => "NotPassportHolder",
            Self::PassportNotVerified => "PassportNotVerified",
            Self::StalePrice => "StalePrice",
            Self::BadOracleAnswer => "BadOracleAnswer",
            Self::PaymentTokenFeedRequired => "PaymentTokenFeedRequired",
            Self::CannotClearPaymentTokenFeed => "CannotClearPaymentTokenFeed",
            Self::ZeroFeedStaleness => "ZeroFeedStaleness",
            Self::StalenessWithoutFeed => "StalenessWithoutFeed",
            Self::FeedStalenessOutOfBounds => "FeedStalenessOutOfBounds",
            Self::InvalidFeed => "InvalidFeed",
            Self::InvalidFeedDecimals => "InvalidFeedDecimals",
            Self::ConfidenceTooWide => "ConfidenceTooWide",
            Self::InvalidCurrencyCode => "InvalidCurrencyCode",
            Self::CurrencyNotAvailableOnChain => "CurrencyNotAvailableOnChain",
        }
    }

    pub fn all() -> &'static [KargainError] {
        use KargainError::*;
        &[
            NonexistentToken,
            NotOwner,
            NotActiveVerifier,
            CannotSelfVerify,
            InvalidStatus,
            EmptyField,
            ZeroAddress,
            ZeroDisputeDeposit,
            SameURI,
            NothingToRescue,
            TokenIdSpaceExhausted,
            GatewayAlreadySet,
            NotBridgeGateway,
            NotForeignToken,
            NotHomeToken,
            TokenExists,
            PassportBridgedAway,
            SourceAlreadyRegistered,
            SourceNotRegistered,
            TooManyEncumbranceSources,
            SourceUnanswerable,
            DisputeActive,
            NoActiveDispute,
            NotDisputeOpener,
            DisputeWindowElapsed,
            DisputeWindowActive,
            CannotResolveOwnDispute,
            WrongValue,
            NotEligibleChallenger,
            NotQualifiedJudge,
            CannotRouteBondToJudge,
            ZeroForfeitRecipient,
            ZeroChallengeWindow,
            ChallengeAlreadyConfigured,
            ChallengeNotConfigured,
            NoClaim,
            TransferFailed,
            LeaveChainRefused,
            NotRepresentationOwner,
            NotLocked,
            ComposeRequired,
            ComposeUndecodable,
            UriTooLong,
            UriExceedsBridgeCeiling,
            BelowMinStake,
            AlreadyVerifier,
            UnbondPending,
            NotVerifier,
            UnbondNotReady,
            NoUnbond,
            BelowMinStakeFloor,
            OnlyStaking,
            AlreadyHoldsPass,
            DoesNotHoldPass,
            Soulbound,
            NotHolder,
            InvalidCategory,
            BelowFloor,
            ShortDelivery,
            TokenHasNoCode,
            TokenNonConforming,
            TokenDecimalsUnavailable,
            ArithmeticOverflow,
            WrongPlatformRecipient,
            MissingPlatformRecipient,
            WrongSellerRecipient,
            MissingSellerRecipient,
            WrongAgentRecipient,
            MissingAgentRecipient,
            TransferFeeExtensionForbidden,
            OpenConsignmentRefused,
            ModeNotEncumbranceSource,
            NotOffered,
            NotDirectConsignment,
            FeeTooHigh,
            NotConsignmentRunner,
            ContractPaused,
            NotGuardian,
            NotGuardianOrOwner,
            NotPassportOwner,
            LiveConsignment,
            NoLiveConsignment,
            EscrowNotApproved,
            MandateExpired,
            NoMandate,
            DenominationMismatch,
            CannotRaiseFloor,
            CannotRaiseCommission,
            NotCommissionForm,
            NotConsignmentAgent,
            NotConsignmentSeller,
            NotOfferedAgented,
            ReturnAlreadyRequested,
            ReturnNotRequested,
            ReturnCooldownPending,
            AscendingOpenPath,
            TermsFixed,
            PaymentTokenNotSupported,
            EmptySettlementNote,
            NotSellerOrAgent,
            DirectEthNotAccepted,
            FiatDenominationRefused,
            BadDuration,
            ProtectionOutOfBounds,
            BadConfig,
            BadReserve,
            BidFromSeller,
            BidFromAgent,
            BidTooLow,
            NotBinding,
            AuctionEnded,
            AuctionNotEnded,
            NoHold,
            HoldNotReady,
            NotHoldBuyer,
            ReversalPending,
            NoReversalPending,
            AbandonmentNotReady,
            ProtectionElapsed,
            SettlementPending,
            NotPassportHolder,
            PassportNotVerified,
            StalePrice,
            BadOracleAnswer,
            PaymentTokenFeedRequired,
            CannotClearPaymentTokenFeed,
            ZeroFeedStaleness,
            StalenessWithoutFeed,
            FeedStalenessOutOfBounds,
            InvalidFeed,
            InvalidFeedDecimals,
            ConfidenceTooWide,
            InvalidCurrencyCode,
            CurrencyNotAvailableOnChain,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_stable_and_unique() {
        let mut names = std::collections::BTreeSet::new();
        for e in KargainError::all() {
            assert!(names.insert(e.name()), "duplicate {}", e.name());
            assert_eq!(format!("{e}"), e.name());
        }
    }

    #[test]
    fn codes_are_dense_from_zero() {
        for (i, e) in KargainError::all().iter().enumerate() {
            assert_eq!(u32::from(*e), i as u32);
        }
    }
}
