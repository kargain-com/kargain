//! Sole passport Core asset address law.
//!
//! Seed `b"asset"` + PDA `[ASSET_SEED, token_id]` under the passport program.
//! Live-asset predicate (D-17) is owned by `kargain-core-liveness` and re-exported
//! here so passport / consignment-base keep one import.
//!
//! Consumers: `kar-passport` (seeds / core_asset) and `kargain-consignment-base`
//! (custody binding). Distinct from harness `b"harness-asset"`.

use solana_program::pubkey::Pubkey;

pub use kargain_core_liveness::is_live_core_asset;

/// Passport Core asset PDA seed — sole owner of these bytes.
pub const ASSET_SEED: &[u8] = b"asset";

/// Derive the passport Core asset PDA for `token_id` under `passport_program`.
pub fn asset_pda(passport_program: &Pubkey, token_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[ASSET_SEED, token_id], passport_program)
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
