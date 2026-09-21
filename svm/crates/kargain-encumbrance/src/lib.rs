//! Encumbrance answer accounts — layout + sole PDA derivation (SPEC §13.7 / D-26).
//!
//! Seeds under the **source** program: `[seed_prefix, token_id, intent]` where
//! `intent` is a single byte (`LeaveChain = 0`, `OpenConsignment = 1`).
//! Passport and modes both call [`derive_encumbrance_answer_pda`] — never a
//! second copy. Account SPACE and signer seed lists live here only.

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

impl EncumbranceAnswer {
    /// Borsh size: disc(8) + token_id(32) + intent(1) + allowed(1).
    pub const SPACE: usize = 8 + 32 + 1 + 1;
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

/// Sole seed recipe for derivation: `[seed_prefix, token_id, intent]`.
///
/// `intent_seed` must be `[intent]` kept alive by the caller.
#[inline]
pub fn encumbrance_answer_seeds<'a>(
    seed_prefix: &'a [u8],
    token_id: &'a [u8; 32],
    intent_seed: &'a [u8; 1],
) -> [&'a [u8]; 3] {
    [seed_prefix, token_id.as_ref(), intent_seed.as_ref()]
}

/// Signer seeds for create / invoke_signed: recipe + bump.
#[inline]
pub fn encumbrance_answer_signer_seeds<'a>(
    seed_prefix: &'a [u8],
    token_id: &'a [u8; 32],
    intent_seed: &'a [u8; 1],
    bump_seed: &'a [u8; 1],
) -> [&'a [u8]; 4] {
    [
        seed_prefix,
        token_id.as_ref(),
        intent_seed.as_ref(),
        bump_seed.as_ref(),
    ]
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
        &encumbrance_answer_seeds(seed_prefix, token_id, &intent_seed),
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
    fn answer_space_matches_borsh() {
        assert_eq!(EncumbranceAnswer::SPACE, 42);
        let rec = EncumbranceAnswer {
            discriminator: ENCUMBRANCE_ANSWER_DISCRIMINATOR,
            token_id: [1u8; 32],
            intent: INTENT_LEAVE_CHAIN,
            allowed: false,
        };
        let mut buf = Vec::new();
        rec.serialize(&mut buf).unwrap();
        assert_eq!(buf.len(), EncumbranceAnswer::SPACE);
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

    #[test]
    fn signer_seeds_match_derivation_recipe() {
        let program = Pubkey::new_from_array([0x33u8; 32]);
        let seed_prefix = b"fp";
        let token = [0x44u8; 32];
        let intent = INTENT_OPEN_CONSIGNMENT;
        let (expected, bump) =
            derive_encumbrance_answer_pda(&program, seed_prefix, &token, intent).unwrap();
        let intent_seed = [intent];
        let bump_seed = [bump];
        let from_signer = Pubkey::create_program_address(
            &encumbrance_answer_signer_seeds(seed_prefix, &token, &intent_seed, &bump_seed),
            &program,
        )
        .unwrap();
        assert_eq!(expected, from_signer);
    }

    #[test]
    fn diverged_signer_recipe_is_red() {
        let program = Pubkey::new_from_array([0x55u8; 32]);
        let seed_prefix = b"fp";
        let token = [0x66u8; 32];
        let intent = INTENT_LEAVE_CHAIN;
        let (expected, bump) =
            derive_encumbrance_answer_pda(&program, seed_prefix, &token, intent).unwrap();
        let intent_seed = [intent];
        let bump_seed = [bump];
        // Plant: swapped seed order (token before prefix) — must not match derive.
        let diverged: [&[u8]; 4] = [
            token.as_ref(),
            seed_prefix,
            intent_seed.as_ref(),
            bump_seed.as_ref(),
        ];
        let from_diverged = Pubkey::create_program_address(&diverged, &program);
        match from_diverged {
            Ok(pk) => assert_ne!(pk, expected, "diverged recipe must not equal derive PDA"),
            Err(_) => {} // off-curve / invalid also proves divergence
        }
        // Live recipe still matches.
        let live = Pubkey::create_program_address(
            &encumbrance_answer_signer_seeds(seed_prefix, &token, &intent_seed, &bump_seed),
            &program,
        )
        .unwrap();
        assert_eq!(live, expected);
    }
}
