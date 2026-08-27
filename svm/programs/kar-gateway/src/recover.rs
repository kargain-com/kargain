//! `recover_locked_home` — SPEC §12.11 / Solidity three preconditions.

use kargain_errors::KargainError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoverPlan {
    pub token_id: [u8; 32],
    pub to: [u8; 32],
}

/// Preconditions (Solidity order):
/// 1. `to ≠ 0`
/// 2. home token (`_isHome`)
/// 3. gateway holds the asset (`ownerOf == gateway` / NotLocked)
///
/// Then: `bridge_reset_on_unlock("", …)` + transfer — **no mint**.
pub fn check_recover_locked_home(
    to: &[u8; 32],
    is_home: bool,
    gateway_holds_asset: bool,
    token_id: [u8; 32],
) -> Result<RecoverPlan, KargainError> {
    if to == &[0u8; 32] {
        return Err(KargainError::ZeroAddress);
    }
    if !is_home {
        return Err(KargainError::NotHomeToken);
    }
    if !gateway_holds_asset {
        return Err(KargainError::NotLocked);
    }
    Ok(RecoverPlan {
        token_id,
        to: *to,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_to_refused() {
        assert_eq!(
            check_recover_locked_home(&[0u8; 32], true, true, [1u8; 32]),
            Err(KargainError::ZeroAddress)
        );
    }

    #[test]
    fn foreign_refused() {
        assert_eq!(
            check_recover_locked_home(&[2u8; 32], false, true, [1u8; 32]),
            Err(KargainError::NotHomeToken)
        );
    }

    #[test]
    fn not_held_refused() {
        assert_eq!(
            check_recover_locked_home(&[2u8; 32], true, false, [1u8; 32]),
            Err(KargainError::NotLocked)
        );
    }

    #[test]
    fn three_preconditions_pass() {
        let plan = check_recover_locked_home(&[2u8; 32], true, true, [9u8; 32]).unwrap();
        assert_eq!(plan.to, [2u8; 32]);
        assert_eq!(plan.token_id, [9u8; 32]);
    }
}
