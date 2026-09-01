//! Instruction enum — borsh-encoded program data.
//!
//! Variant order is append-only (gateway + stand encode by discriminant index).

use borsh::{BorshDeserialize, BorshSerialize};

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub enum PassportIx {
    /// Owner initializes config PDA (П-12 fields).
    Initialize {
        namespace: u128,
        local_eid: u32,
        endpoint_program: [u8; 32],
        dispute_deposit: u64,
        staking_program: [u8; 32],
        forfeit_recipient: [u8; 32],
    },
    SetBridgeGateway {
        gateway: [u8; 32],
    },
    MintPassport {
        uri: String,
    },
    SetPassportUri {
        token_id: [u8; 32],
        uri: String,
    },
    /// View-style: returns via program logs / account; host tests use `may` module.
    May {
        token_id: [u8; 32],
        intent: u8,
    },
    AppendRecord {
        token_id: [u8; 32],
        record_type: String,
        description: String,
        evidence_cid: String,
    },
    // ---- Gateway-only ----
    SetCustodyLock {
        token_id: [u8; 32],
        locked: bool,
    },
    BridgeMint {
        to: [u8; 32],
        token_id: [u8; 32],
        uri: String,
    },
    BridgeBurn {
        token_id: [u8; 32],
    },
    BridgeResetOnUnlock {
        token_id: [u8; 32],
        uri: String,
    },
    // ---- S5 append-only ----
    /// Authority rebinds staking program (mock → commercial; A3 pair swap).
    SetStakingProgram {
        staking_program: [u8; 32],
    },
    /// Active verifier marks passport VERIFIED (answer-account stake proof).
    VerifyPassport {
        token_id: [u8; 32],
    },
    // ---- S7a append-only ----
    OpenChallenge {
        token_id: [u8; 32],
    },
    WithdrawChallenge {
        token_id: [u8; 32],
    },
    JudgeChallenge {
        token_id: [u8; 32],
        outcome: u8,
    },
    ConcludeChallenge {
        token_id: [u8; 32],
    },
    WithdrawClaim,
    SetDisputeDeposit {
        dispute_deposit: u64,
    },
    ReportDiscrepancy {
        token_id: [u8; 32],
        description: String,
        evidence_cid: String,
    },
    AppendAttestation {
        token_id: [u8; 32],
        description: String,
        evidence_cid: String,
    },
    /// Owner-initiated Core transfer — emits `Transfer` (not mint-from-zero).
    TransferPassport {
        token_id: [u8; 32],
    },
}
