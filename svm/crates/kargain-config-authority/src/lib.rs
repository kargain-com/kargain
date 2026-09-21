//! Sole pure config-authority admission (passport ∩ mode programs).
//!
//! Unsigned → `MissingRequiredSignature`. Signed wrong key → `KargainError::NotOwner`.
//! Each program keeps its own config-PDA / config-load checks around this owner.

use kargain_errors::KargainError;
use solana_program::program_error::ProgramError;

/// Pure admission: signer flag + authority key vs expected config authority.
///
/// No AccountInfo, no PDA — host-testable. Callers prove config PDA / load first.
pub fn admit_config_authority(
    authority_is_signer: bool,
    authority_key: &[u8; 32],
    expected_authority: &[u8; 32],
) -> Result<(), ProgramError> {
    if !authority_is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if authority_key != expected_authority {
        return Err(ProgramError::Custom(u32::from(KargainError::NotOwner)));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(b: u8) -> [u8; 32] {
        [b; 32]
    }

    #[test]
    fn admit_unsigned_refused_missing_signature() {
        let err = admit_config_authority(false, &pk(1), &pk(1)).expect_err("unsigned");
        assert_eq!(err, ProgramError::MissingRequiredSignature);
    }

    #[test]
    fn admit_signed_wrong_key_refused_not_owner() {
        let err = admit_config_authority(true, &pk(2), &pk(1)).expect_err("wrong key");
        assert_eq!(
            err,
            ProgramError::Custom(u32::from(KargainError::NotOwner))
        );
    }

    #[test]
    fn admit_correct_accepted() {
        assert!(admit_config_authority(true, &pk(1), &pk(1)).is_ok());
    }
}
