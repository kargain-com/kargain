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
