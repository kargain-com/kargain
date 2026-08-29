//! URI rules — mint may be empty; `set_passport_uri` empty → EmptyField (SPEC / A-5).
//! Write paths enforce `PASSPORT_URI_CEILING_BYTES` with `UriTooLong`.
//! Bridge receive (`bridge_mint` / unlock adopt) does **not** length-reject.

use kargain_errors::{KargainError, PASSPORT_URI_CEILING_BYTES};

use crate::state::Status;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UriSetOutcome {
    Applied { reset_verification: bool },
}

/// `set_passport_uri` check order matching Solidity (length after SameURI, via write wrapper).
pub fn check_set_uri(
    custody_locked: bool,
    is_owner: bool,
    new_uri: &str,
    current_uri: &str,
    status: Status,
) -> Result<UriSetOutcome, KargainError> {
    if custody_locked {
        return Err(KargainError::PassportBridgedAway);
    }
    if !is_owner {
        return Err(KargainError::NotOwner);
    }
    if new_uri.is_empty() {
        return Err(KargainError::EmptyField);
    }
    if status == Status::Disputed {
        return Err(KargainError::InvalidStatus);
    }
    if new_uri == current_uri {
        return Err(KargainError::SameURI);
    }
    check_write_uri_length(new_uri)?;
    Ok(UriSetOutcome::Applied {
        reset_verification: status == Status::Verified,
    })
}

/// Mint allows empty URI (Solidity `mintPassport`); over-ceiling → `UriTooLong`.
pub fn check_mint_uri(uri: &str) -> Result<(), KargainError> {
    check_write_uri_length(uri)
}

fn check_write_uri_length(uri: &str) -> Result<(), KargainError> {
    if uri.len() > PASSPORT_URI_CEILING_BYTES {
        return Err(KargainError::UriTooLong);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uri_of_len(n: usize) -> String {
        if n <= 5 {
            return "x".repeat(n);
        }
        format!("ar://{}", "x".repeat(n - 5))
    }

    #[test]
    fn empty_set_uri_is_empty_field() {
        assert_eq!(
            check_set_uri(false, true, "", "ar://x", Status::Unverified),
            Err(KargainError::EmptyField)
        );
    }

    #[test]
    fn empty_mint_allowed() {
        assert!(check_mint_uri("").is_ok());
        assert!(check_mint_uri("ar://ok").is_ok());
    }

    #[test]
    fn mint_at_ceiling_ok() {
        let u = uri_of_len(PASSPORT_URI_CEILING_BYTES);
        assert_eq!(u.len(), PASSPORT_URI_CEILING_BYTES);
        assert!(check_mint_uri(&u).is_ok());
    }

    #[test]
    fn mint_over_ceiling_uri_too_long() {
        let u = uri_of_len(PASSPORT_URI_CEILING_BYTES + 1);
        assert_eq!(u.len(), PASSPORT_URI_CEILING_BYTES + 1);
        assert_eq!(check_mint_uri(&u), Err(KargainError::UriTooLong));
    }

    #[test]
    fn set_uri_at_ceiling_ok() {
        let u = uri_of_len(PASSPORT_URI_CEILING_BYTES);
        assert!(check_set_uri(false, true, &u, "ar://x", Status::Unverified).is_ok());
    }

    #[test]
    fn set_uri_over_ceiling_uri_too_long() {
        let u = uri_of_len(PASSPORT_URI_CEILING_BYTES + 1);
        assert_eq!(
            check_set_uri(false, true, &u, "ar://x", Status::Unverified),
            Err(KargainError::UriTooLong)
        );
    }

    #[test]
    fn custody_locked_blocks_set_uri() {
        assert_eq!(
            check_set_uri(true, true, "ar://y", "ar://x", Status::Unverified),
            Err(KargainError::PassportBridgedAway)
        );
    }

    #[test]
    fn verified_set_resets() {
        let out = check_set_uri(false, true, "ar://y", "ar://x", Status::Verified).unwrap();
        assert_eq!(
            out,
            UriSetOutcome::Applied {
                reset_verification: true
            }
        );
    }
}
