//! Sole `[b"freeze"]` PermanentFreezeDelegate authority PDA recipe.
//!
//! Parameterized only by program id. Consumers: kar-gateway (signer for
//! custody freeze/thaw) and kar-passport (mint paths check the derived key).
//! Distinct from kar-pro-pass's own freeze PDA under the pass program id.

use solana_program::pubkey::Pubkey;

/// Permanent freeze authority PDA seed — sole owner of these bytes.
pub const FREEZE_SEED: &[u8] = b"freeze";

/// Derive the PermanentFreezeDelegate authority PDA under `program_id`.
pub fn freeze_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[FREEZE_SEED], program_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_is_freeze() {
        assert_eq!(FREEZE_SEED, b"freeze");
    }

    #[test]
    fn freeze_pda_deterministic_and_program_scoped() {
        let a = Pubkey::new_from_array([7u8; 32]);
        let b = Pubkey::new_from_array([8u8; 32]);
        let (pa, ba) = freeze_pda(&a);
        let (again, _) = Pubkey::find_program_address(&[FREEZE_SEED], &a);
        assert_eq!(pa, again);
        let (pb, _) = freeze_pda(&b);
        assert_ne!(pa, pb);
        assert!(ba <= 255);
    }
}
