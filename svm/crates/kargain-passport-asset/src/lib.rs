//! Sole passport Core asset address law + live-asset predicate.
//!
//! Seed `b"asset"` + PDA `[ASSET_SEED, token_id]` under the passport program.
//! Live (D-17): owned by mpl-core with more than the 1-byte burn tombstone.
//!
//! Consumers: `kar-passport` (seeds / core_asset) and `kargain-consignment-base`
//! (custody binding). Distinct from harness `b"harness-asset"`.

use solana_program::{account_info::AccountInfo, pubkey::Pubkey};

/// Passport Core asset PDA seed — sole owner of these bytes.
pub const ASSET_SEED: &[u8] = b"asset";

/// Derive the passport Core asset PDA for `token_id` under `passport_program`.
pub fn asset_pda(passport_program: &Pubkey, token_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[ASSET_SEED, token_id], passport_program)
}

/// Live Core asset (D-17): owned by Core with more than the 1-byte burn tombstone.
pub fn is_live_core_asset(asset: &AccountInfo) -> bool {
    asset.owner == &mpl_core::ID && asset.data_len() > 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_is_asset_not_harness() {
        assert_eq!(ASSET_SEED, b"asset");
        assert_ne!(ASSET_SEED, b"harness-asset");
    }

    #[test]
    fn asset_pda_deterministic() {
        let program = Pubkey::new_from_array([7u8; 32]);
        let token = [3u8; 32];
        let (a, _) = asset_pda(&program, &token);
        let (b, _) = Pubkey::find_program_address(&[ASSET_SEED, &token], &program);
        assert_eq!(a, b);
    }
}
