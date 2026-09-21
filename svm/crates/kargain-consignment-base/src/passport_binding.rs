//! One-shot passport-program binding for mode programs (S8-E step 5).
//!
//! FixedPrice (and Ascending in step 6) store the bound passport program id in a
//! mode-owned PDA. Layout is independent of `CommerceConfig` (live configs are
//! 109 B and shared across modes).

use borsh::{BorshDeserialize, BorshSerialize};
use kargain_errors::KargainError;
use solana_program::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
};

/// Seed under the mode program id for the one-shot passport binding PDA.
pub const PASSPORT_BINDING_SEED: &[u8] = b"passport-bind";

pub const PASSPORT_BINDING_DISCRIMINATOR: [u8; 8] = *b"kp_pbind";

#[derive(Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct PassportBinding {
    pub discriminator: [u8; 8],
    pub passport_program: [u8; 32],
    pub bump: u8,
}

impl PassportBinding {
    pub const SPACE: usize = 8 + 32 + 1;

    pub fn new(passport_program: Pubkey, bump: u8) -> Self {
        Self {
            discriminator: PASSPORT_BINDING_DISCRIMINATOR,
            passport_program: passport_program.to_bytes(),
            bump,
        }
    }

    pub fn passport_program_key(&self) -> Pubkey {
        Pubkey::new_from_array(self.passport_program)
    }
}

/// Derive the passport-binding PDA under `mode_program`.
#[inline]
pub fn passport_binding_pda(mode_program: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PASSPORT_BINDING_SEED], mode_program)
}

fn into_pe(e: KargainError) -> ProgramError {
    ProgramError::Custom(u32::from(e))
}

/// Load a bound passport program id, or refuse with `PassportProgramUnbound`.
pub fn require_bound_passport_program(
    mode_program: &Pubkey,
    binding_info: &AccountInfo,
) -> Result<Pubkey, ProgramError> {
    let (expected, _) = passport_binding_pda(mode_program);
    if binding_info.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if binding_info.owner != mode_program {
        return Err(ProgramError::IncorrectProgramId);
    }
    let data = binding_info.try_borrow_data()?;
    if data.len() < PassportBinding::SPACE {
        return Err(into_pe(KargainError::PassportProgramUnbound));
    }
    let binding = PassportBinding::try_from_slice(&data[..PassportBinding::SPACE])
        .map_err(|_| into_pe(KargainError::PassportProgramUnbound))?;
    if binding.discriminator != PASSPORT_BINDING_DISCRIMINATOR {
        return Err(into_pe(KargainError::PassportProgramUnbound));
    }
    Ok(binding.passport_program_key())
}

/// Refuse a second bind when the binding PDA is already initialised.
pub fn require_binding_uninitialised(binding_info: &AccountInfo) -> Result<(), ProgramError> {
    let data = binding_info.try_borrow_data()?;
    if data.is_empty() {
        return Ok(());
    }
    if data.len() >= 8 && data[..8] == PASSPORT_BINDING_DISCRIMINATOR {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    // Non-empty without our disc still blocks rebind (one-shot slot occupied).
    if !data.iter().all(|&b| b == 0) {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn space_is_exact() {
        assert_eq!(PassportBinding::SPACE, 41);
        let b = PassportBinding::new(Pubkey::new_unique(), 255);
        let mut buf = Vec::new();
        b.serialize(&mut buf).unwrap();
        assert_eq!(buf.len(), PassportBinding::SPACE);
    }

    #[test]
    fn pda_derivation_is_stable() {
        let mode = Pubkey::new_from_array([7u8; 32]);
        let (a, bump) = passport_binding_pda(&mode);
        let (b, bump2) = passport_binding_pda(&mode);
        assert_eq!(a, b);
        assert_eq!(bump, bump2);
        assert_ne!(a, mode);
    }

    #[test]
    fn unbound_error_ordinal_is_140() {
        assert_eq!(u32::from(KargainError::PassportProgramUnbound), 140);
    }
}
