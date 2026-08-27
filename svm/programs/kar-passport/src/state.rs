//! On-chain account layouts (borsh). Model constants may live here; П-12 fields do not.

use borsh::{BorshDeserialize, BorshSerialize};
use kargain_bonded_challenge::BondedChallengeState;
use kargain_claimable_payouts::ClaimablePayoutsState;

/// SPEC §13.10 model constant — identical on every chain; not a Timelock knob.
pub const DISPUTE_WINDOW_SECONDS: u64 = 1_209_600; // 14d
pub const MAX_ENCUMBRANCE_SOURCES: usize = 8;

/// Status ordinals match Solidity `KarPassport.Status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize, Default)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum Status {
    #[default]
    Unverified = 0,
    Verified = 1,
    Disputed = 2,
}

/// Intent ordinals match `IKarPassportEncumbrance.Intent` / `IEncumbranceSource.Intent`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum Intent {
    LeaveChain = 0,
    OpenConsignment = 1,
}

/// Config PDA — П-12 fields. Same BPF for local mock and later Devnet.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct PassportConfig {
    pub discriminator: [u8; 8],
    pub authority: [u8; 32],
    /// High 128 bits of home tokenIds (e.g. `2_000_040_168` for Solana Devnet).
    pub namespace: u128,
    /// Local LayerZero EID (e.g. 40168) — not compile-time.
    pub local_eid: u32,
    /// Endpoint program id from config (mock locally, real Endpoint later).
    pub endpoint_program: [u8; 32],
    /// Native dispute bond in lamports — weight-derived at deploy; not bytecode.
    pub dispute_deposit: u64,
    pub staking_program: [u8; 32],
    /// Bound once via `set_bridge_gateway` (GatewayAlreadySet after first bind).
    pub bridge_gateway: [u8; 32],
    pub forfeit_recipient: [u8; 32],
    /// `next_token_id` starts at `namespace << 128`.
    pub next_token_id: [u8; 32],
    /// Registered encumbrance sources: program id + answer seed prefix (SPEC §13.7).
    pub encumbrance_sources: Vec<EncumbranceSourceEntry>,
    pub bump: u8,
}

pub const PASSPORT_CONFIG_DISCRIMINATOR: [u8; 8] = *b"kp_cfg\0\0";

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct EncumbranceSourceEntry {
    pub program_id: [u8; 32],
    /// Registry-declared seed prefix; passport derives answer PDA per source.
    pub seed_prefix: Vec<u8>,
}

/// Per-token state PDA — never closed. After foreign burn: `burned = true` tombstone.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct PassportState {
    pub discriminator: [u8; 8],
    pub token_id: [u8; 32],
    pub status: Status,
    pub verifier: [u8; 32],
    pub verified_at: u64,
    /// Custody-lock freezes the home trust surface (SPEC §12.4 / §13.6).
    /// `may` does **not** read this (D-14).
    pub custody_locked: bool,
    /// True after foreign `bridge_burn`; asset may be Core 1-byte tombstone.
    pub burned: bool,
    pub record_count: u32,
    pub bump: u8,
}

pub const PASSPORT_STATE_DISCRIMINATOR: [u8; 8] = *b"kp_st\0\0\0";

impl PassportState {
    pub fn new_unverified(token_id: [u8; 32], bump: u8) -> Self {
        Self {
            discriminator: PASSPORT_STATE_DISCRIMINATOR,
            token_id,
            status: Status::Unverified,
            verifier: [0u8; 32],
            verified_at: 0,
            custody_locked: false,
            burned: false,
            record_count: 0,
            bump,
        }
    }
}

/// One account per record — never closed (SPEC §12.8 / D-10 / D-17).
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct PassportRecord {
    pub discriminator: [u8; 8],
    pub token_id: [u8; 32],
    pub index: u32,
    pub timestamp: u64,
    pub author: [u8; 32],
    pub record_type: String,
    pub description: String,
    pub evidence_cid: String,
    pub bump: u8,
}

pub const PASSPORT_RECORD_DISCRIMINATOR: [u8; 8] = *b"kp_rec\0\0";

/// Program-global challenge + payout bookkeeping (mirrors Solidity storage).
#[derive(Debug, Clone, Default, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct PassportChallengeBook {
    pub challenge: BondedChallengeState,
    pub payouts: ClaimablePayoutsState,
}

/// Answer record layout for encumbrance sources (SPEC §13.7).
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct EncumbranceAnswer {
    pub discriminator: [u8; 8],
    pub token_id: [u8; 32],
    pub intent: u8,
    /// `true` = allows; uninitialised account = no obligation.
    pub allowed: bool,
}

pub const ENCUMBRANCE_ANSWER_DISCRIMINATOR: [u8; 8] = *b"enc_ans\0";

/// Encode `token_id = (namespace << 128) | local_seq` as 32-byte big-endian.
pub fn token_id_from_parts(namespace: u128, local_seq: u128) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[0..16].copy_from_slice(&namespace.to_be_bytes());
    out[16..32].copy_from_slice(&local_seq.to_be_bytes());
    out
}

pub fn namespace_of(token_id: &[u8; 32]) -> u128 {
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&token_id[0..16]);
    u128::from_be_bytes(buf)
}

pub fn is_home_token(token_id: &[u8; 32], local_namespace: u128) -> bool {
    namespace_of(token_id) == local_namespace
}
