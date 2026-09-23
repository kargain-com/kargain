use solana_program::pubkey::Pubkey;

pub use kargain_config_pda::{config_pda, CONFIG_SEED};
pub const STAKE_SEED: &[u8] = b"stake";

pub fn stake_pda(program_id: &Pubkey, verifier: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[STAKE_SEED, verifier], program_id)
}
