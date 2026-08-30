use solana_program::pubkey::Pubkey;

pub const CONFIG_SEED: &[u8] = b"config";
pub const FREEZE_SEED: &[u8] = b"freeze";
/// Core asset PDA — one pass per holder.
pub const PASS_SEED: &[u8] = b"pass";
/// Off-chain profile fields (category / name / uri / issued_at).
pub const PASS_META_SEED: &[u8] = b"pass_meta";

pub fn config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], program_id)
}

pub fn freeze_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[FREEZE_SEED], program_id)
}

pub fn pass_asset_pda(program_id: &Pubkey, holder: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PASS_SEED, holder], program_id)
}

pub fn pass_meta_pda(program_id: &Pubkey, holder: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PASS_META_SEED, holder], program_id)
}
