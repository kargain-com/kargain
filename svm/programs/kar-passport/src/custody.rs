//! Custody-lock checks for owner trust-mutating paths (not `may`).

use kargain_errors::KargainError;

pub fn require_not_bridged_away(custody_locked: bool) -> Result<(), KargainError> {
    if custody_locked {
        Err(KargainError::PassportBridgedAway)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locked_refuses() {
        assert_eq!(
            require_not_bridged_away(true),
            Err(KargainError::PassportBridgedAway)
        );
    }

    #[test]
    fn unlocked_ok() {
        assert!(require_not_bridged_away(false).is_ok());
    }
}
