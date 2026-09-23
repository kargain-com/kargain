//! Sole `[b"config"]` program-config PDA recipe.
//!
//! One seed, parameterized only by program id. Consumers: kar-passport, kar-gateway,
//! kar-pro-staking, kar-pro-pass (own config) and the two cross-program readers
//! (`is_bridge_gateway_signer`, `require_staking_signer`). Distinct from
//! consignment `b"consign-config"` and mock-endpoint `b"ep_config"`.

use solana_program::pubkey::Pubkey;

/// Program-config PDA seed — sole owner of these bytes.
pub const CONFIG_SEED: &[u8] = b"config";

/// Derive the program-config PDA under `program_id`.
pub fn config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], program_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_is_config_not_consign_or_endpoint() {
        assert_eq!(CONFIG_SEED, b"config");
        assert_ne!(CONFIG_SEED, b"consign-config");
        assert_ne!(CONFIG_SEED, b"ep_config");
    }

    #[test]
    fn config_pda_deterministic_and_program_scoped() {
        let a = Pubkey::new_from_array([7u8; 32]);
        let b = Pubkey::new_from_array([8u8; 32]);
        let (pa, ba) = config_pda(&a);
        let (again, _) = Pubkey::find_program_address(&[CONFIG_SEED], &a);
        assert_eq!(pa, again);
        let (pb, _) = config_pda(&b);
        assert_ne!(pa, pb);
        assert!(ba <= 255);
    }
}
