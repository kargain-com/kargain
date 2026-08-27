//! URI rules — mint may be empty; `set_passport_uri` empty → EmptyField (SPEC / A-5).

use kargain_errors::KargainError;

use crate::state::Status;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UriSetOutcome {
    Applied { reset_verification: bool },
}

/// `set_passport_uri` check order matching Solidity.
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
    Ok(UriSetOutcome::Applied {
        reset_verification: status == Status::Verified,
    })
}

/// Mint allows empty URI (Solidity `mintPassport`).
pub fn mint_uri_ok(uri: &str) -> bool {
    let _ = uri;
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_set_uri_is_empty_field() {
        assert_eq!(
            check_set_uri(false, true, "", "ar://x", Status::Unverified),
            Err(KargainError::EmptyField)
        );
    }

    #[test]
    fn empty_mint_allowed() {
        assert!(mint_uri_ok(""));
        assert!(mint_uri_ok("ar://ok"));
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
