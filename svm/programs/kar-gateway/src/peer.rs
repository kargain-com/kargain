//! PeerConfig PDA — directional remote OApp trust (LZ Solana OApp pattern).
//! Seeds: `Peer` + gateway_config + remote_eid (be bytes).

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

use crate::seeds::PEER_SEED;

pub const PEER_CONFIG_DISCRIMINATOR: [u8; 8] = *b"peer_cfg";

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct PeerConfig {
    pub discriminator: [u8; 8],
    pub peer_address: [u8; 32],
    pub bump: u8,
}

impl PeerConfig {
    pub const SPACE: usize = 8 + 32 + 1;

    pub fn new(peer_address: [u8; 32], bump: u8) -> Self {
        Self {
            discriminator: PEER_CONFIG_DISCRIMINATOR,
            peer_address,
            bump,
        }
    }
}

pub fn peer_pda(program_id: &Pubkey, gateway_config: &Pubkey, remote_eid: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            PEER_SEED,
            gateway_config.as_ref(),
            &remote_eid.to_be_bytes(),
        ],
        program_id,
    )
}

/// Hub EID for this spoke (star topology — only peer allowed on Solana Devnet gateway).
pub const HUB_EID: u32 = 40245;
