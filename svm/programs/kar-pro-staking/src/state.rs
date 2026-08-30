//! Staking config + stake account layouts (readable by passport answer-account).

use borsh::{BorshDeserialize, BorshSerialize};

pub const STAKING_CONFIG_DISCRIMINATOR: [u8; 8] = *b"kps_cfg\0";
/// Production stake discriminator — not mock `m_stake\0`.
pub const STAKE_DISCRIMINATOR: [u8; 8] = *b"kps_stk\0";

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct StakingConfig {
    pub discriminator: [u8; 8],
    pub authority: [u8; 32],
    pub pass_program: [u8; 32],
    /// П-12 — lamports; pinned at deploy from ETH weight.
    pub min_stake_lamports: u64,
    pub min_stake_floor_lamports: u64,
    /// П-12 — seconds (EVM default 14d = 1_209_600).
    pub unbonding_period_secs: u64,
    pub bump: u8,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct StakeAccount {
    pub discriminator: [u8; 8],
    pub wallet: [u8; 32],
    pub amount: u64,
    pub staked_at: u64,
    pub active: bool,
    pub unlock_at: u64,
    pub verification_fee: u64,
    pub bump: u8,
}

/// Fixed stake PDA allocation (never resized). Borsh payload is shorter; padding reserved.
/// Sole size owner — do not invent a second packed-size helper.
pub const STAKE_ACCOUNT_SPACE: usize = 128;
