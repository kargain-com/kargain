//! Pass config + per-holder metadata.

use borsh::{BorshDeserialize, BorshSerialize};

/// Max category ordinal — matches Solidity `KarProPass.Category.OTHER`.
pub const MAX_CATEGORY: u8 = 5;

pub const PASS_CONFIG_DISCRIMINATOR: [u8; 8] = *b"kpp_cfg\0";
pub const PASS_META_DISCRIMINATOR: [u8; 8] = *b"kpp_meta";

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct PassConfig {
    pub discriminator: [u8; 8],
    pub authority: [u8; 32],
    /// Bound staking program — sole minter/closer (CPI via staking config PDA).
    pub staking_program: [u8; 32],
    pub bump: u8,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct PassMeta {
    pub discriminator: [u8; 8],
    pub holder: [u8; 32],
    pub category: u8,
    pub name: String,
    pub metadata_uri: String,
    pub issued_at: u64,
    pub bump: u8,
}
