use solana_program::pubkey::Pubkey;

pub const CONFIG_SEED: &[u8] = b"config";
pub const STAKE_SEED: &[u8] = b"stake";

pub fn config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], program_id)
}

pub fn stake_pda(program_id: &Pubkey, verifier: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[STAKE_SEED, verifier], program_id)
}
