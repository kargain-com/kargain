//! Encumbrance answer accounts — layout + sole PDA derivation (SPEC §13.7 / D-26).
//!
//! Seeds under the **source** program: `[seed_prefix, token_id, intent]` where
//! `intent` is a single byte (`LeaveChain = 0`, `OpenConsignment = 1`).
//! Passport and modes both call [`derive_encumbrance_answer_pda`] — never a
//! second copy.

use borsh::{BorshDeserialize, BorshSerialize};
use kargain_errors::KargainError;
use solana_program::pubkey::Pubkey;

/// Max registered sources (matches EVM / passport `MAX_ENCUMBRANCE_SOURCES`).
pub const MAX_ENCUMBRANCE_SOURCES: usize = 8;

/// Solana PDA seed component ceiling.
pub const MAX_SEED_PREFIX_LEN: usize = 32;

/// Intent ordinals match `IKarPassportEncumbrance.Intent`.
pub const INTENT_LEAVE_CHAIN: u8 = 0;
pub const INTENT_OPEN_CONSIGNMENT: u8 = 1;

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct EncumbranceSourceEntry {
    pub program_id: [u8; 32],
    /// Registry-declared seed prefix; answer PDA derives under the source program.
    pub seed_prefix: Vec<u8>,
}

/// Answer record layout for encumbrance sources (SPEC §13.7).
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct EncumbranceAnswer {
    pub discriminator: [u8; 8],
    pub token_id: [u8; 32],
    pub intent: u8,
    /// `true` = allows; uninitialised account = no obligation.
    pub allowed: bool,
}

pub const ENCUMBRANCE_ANSWER_DISCRIMINATOR: [u8; 8] = *b"enc_ans\0";

/// Refuse empty or oversized `seed_prefix` (Solana seed component rules).
pub fn require_valid_seed_prefix(seed_prefix: &[u8]) -> Result<(), KargainError> {
    if seed_prefix.is_empty() || seed_prefix.len() > MAX_SEED_PREFIX_LEN {
        return Err(KargainError::InvalidEncumbranceSeed);
    }
    Ok(())
}

/// Refuse intent outside LeaveChain / OpenConsignment.
pub fn require_valid_intent(intent: u8) -> Result<(), KargainError> {
    if intent != INTENT_LEAVE_CHAIN && intent != INTENT_OPEN_CONSIGNMENT {
        return Err(KargainError::InvalidEncumbranceIntent);
    }
    Ok(())
}

/// Sole answer-PDA derivation: `[seed_prefix, token_id, intent]` under `source_program`.
pub fn derive_encumbrance_answer_pda(
    source_program: &Pubkey,
    seed_prefix: &[u8],
    token_id: &[u8; 32],
    intent: u8,
) -> Result<(Pubkey, u8), KargainError> {
    require_valid_seed_prefix(seed_prefix)?;
    require_valid_intent(intent)?;
    let intent_seed = [intent];
    Ok(Pubkey::find_program_address(
        &[seed_prefix, token_id, &intent_seed],
        source_program,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_seed_prefix_refused() {
        assert_eq!(
            require_valid_seed_prefix(&[]),
            Err(KargainError::InvalidEncumbranceSeed)
        );
    }

    #[test]
    fn oversized_seed_prefix_refused() {
        assert_eq!(
            require_valid_seed_prefix(&[0u8; 33]),
            Err(KargainError::InvalidEncumbranceSeed)
        );
    }

    #[test]
    fn invalid_intent_refused() {
        assert_eq!(
            require_valid_intent(2),
            Err(KargainError::InvalidEncumbranceIntent)
        );
    }

    #[test]
    fn derive_deterministic_for_ans_prefix() {
        let program = Pubkey::new_from_array([0x11u8; 32]);
        let token = [0x22u8; 32];
        let (a, bump_a) =
            derive_encumbrance_answer_pda(&program, b"ans", &token, INTENT_LEAVE_CHAIN).unwrap();
        let (b, bump_b) =
            derive_encumbrance_answer_pda(&program, b"ans", &token, INTENT_LEAVE_CHAIN).unwrap();
        assert_eq!(a, b);
        assert_eq!(bump_a, bump_b);
        let (c, _) =
            derive_encumbrance_answer_pda(&program, b"ans", &token, INTENT_OPEN_CONSIGNMENT)
                .unwrap();
        assert_ne!(a, c, "intent byte must separate LeaveChain from OpenConsignment");
    }

    #[test]
    fn derive_empty_prefix_errors() {
        let program = Pubkey::new_from_array([0x11u8; 32]);
        assert_eq!(
            derive_encumbrance_answer_pda(&program, &[], &[0u8; 32], 0),
            Err(KargainError::InvalidEncumbranceSeed)
        );
    }
}
