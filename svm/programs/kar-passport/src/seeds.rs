//! PDA seeds — deterministic from tokenId + config (no stored asset pubkey lookup).

use solana_program::pubkey::Pubkey;

pub const CONFIG_SEED: &[u8] = b"config";
pub const ASSET_SEED: &[u8] = b"asset";
pub const STATE_SEED: &[u8] = b"state";
pub const RECORD_SEED: &[u8] = b"record";

pub fn config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], program_id)
}

pub fn asset_pda(program_id: &Pubkey, token_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[ASSET_SEED, token_id], program_id)
}

pub fn state_pda(program_id: &Pubkey, token_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[STATE_SEED, token_id], program_id)
}

/// One account per record; never closed. Index is little-endian u32.
pub fn record_pda(program_id: &Pubkey, token_id: &[u8; 32], index: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[RECORD_SEED, token_id, &index.to_le_bytes()],
        program_id,
    )
}
