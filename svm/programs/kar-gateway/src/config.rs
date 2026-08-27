//! Gateway config — П-12 (no compile-time EID / endpoint / lamports).

use borsh::{BorshDeserialize, BorshSerialize};

pub const GATEWAY_CONFIG_DISCRIMINATOR: [u8; 8] = *b"gw_cfg\0\0";

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct GatewayConfig {
    pub discriminator: [u8; 8],
    pub authority: [u8; 32],
    /// Local LayerZero EID from config.
    pub local_eid: u32,
    /// Endpoint program — mock on the stand, real Endpoint later.
    pub endpoint_program: [u8; 32],
    pub passport_program: [u8; 32],
    /// Local Kargain namespace (must match passport config).
    pub namespace: u128,
    pub bump: u8,
    pub freeze_bump: u8,
}
