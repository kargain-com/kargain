//! Gateway-only bridge entrypoints — host-check order matching KarPassport.sol §12.7.

use kargain_errors::KargainError;

use crate::state::{is_home_token, Status};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BridgeMintPlan {
    pub status: Status,
    pub uri: String,
}

pub fn check_bridge_mint(
    caller_is_gateway: bool,
    token_id: &[u8; 32],
    local_namespace: u128,
    asset_already_exists: bool,
    uri: &str,
) -> Result<BridgeMintPlan, KargainError> {
    if !caller_is_gateway {
        return Err(KargainError::NotBridgeGateway);
    }
    if is_home_token(token_id, local_namespace) {
        return Err(KargainError::NotForeignToken);
    }
    // TokenExists / mint existence = Core asset, not state (D-17).
    if asset_already_exists {
        return Err(KargainError::TokenExists);
    }
    Ok(BridgeMintPlan {
        status: Status::Unverified,
        uri: uri.to_string(),
    })
}

pub fn check_bridge_burn(
    caller_is_gateway: bool,
    token_id: &[u8; 32],
    local_namespace: u128,
    asset_exists: bool,
) -> Result<(), KargainError> {
    if !caller_is_gateway {
        return Err(KargainError::NotBridgeGateway);
    }
    if is_home_token(token_id, local_namespace) {
        return Err(KargainError::NotForeignToken);
    }
    if !asset_exists {
        return Err(KargainError::NonexistentToken);
    }
    Ok(())
}

pub fn check_set_custody_lock(
    caller_is_gateway: bool,
    token_id: &[u8; 32],
    local_namespace: u128,
    asset_exists: bool,
) -> Result<(), KargainError> {
    if !caller_is_gateway {
        return Err(KargainError::NotBridgeGateway);
    }
    if !is_home_token(token_id, local_namespace) {
        return Err(KargainError::NotHomeToken);
    }
    if !asset_exists {
        return Err(KargainError::NonexistentToken);
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BridgeResetPlan {
    pub emit_verification_reset: bool,
    pub adopt_uri: bool,
    pub clear_custody_lock: bool,
}

/// Home unlock / recover: status→UNVERIFIED; adopt URI only when non-empty.
pub fn check_bridge_reset_on_unlock(
    caller_is_gateway: bool,
    token_id: &[u8; 32],
    local_namespace: u128,
    asset_exists: bool,
    prior_status: Status,
    uri: &str,
) -> Result<BridgeResetPlan, KargainError> {
    if !caller_is_gateway {
        return Err(KargainError::NotBridgeGateway);
    }
    if !is_home_token(token_id, local_namespace) {
        return Err(KargainError::NotHomeToken);
    }
    if !asset_exists {
        return Err(KargainError::NonexistentToken);
    }
    Ok(BridgeResetPlan {
        emit_verification_reset: prior_status == Status::Verified,
        adopt_uri: !uri.is_empty(),
        clear_custody_lock: true,
    })
}

pub fn check_set_bridge_gateway(
    already_set: bool,
    gateway_is_zero: bool,
) -> Result<(), KargainError> {
    if already_set {
        return Err(KargainError::GatewayAlreadySet);
    }
    if gateway_is_zero {
        return Err(KargainError::ZeroAddress);
    }
    Ok(())
}

/// Staking stub: missing/false → NotActiveVerifier (not SourceUnanswerable).
pub fn check_active_verifier(is_active: Option<bool>) -> Result<(), KargainError> {
    match is_active {
        Some(true) => Ok(()),
        Some(false) | None => Err(KargainError::NotActiveVerifier),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::token_id_from_parts;

    const NS: u128 = 2_000_040_168;

    #[test]
    fn bridge_mint_home_refused() {
        let tid = token_id_from_parts(NS, 1);
        assert_eq!(
            check_bridge_mint(true, &tid, NS, false, "ar://x"),
            Err(KargainError::NotForeignToken)
        );
    }

    #[test]
    fn bridge_mint_existing_asset_token_exists() {
        let tid = token_id_from_parts(84532, 1);
        assert_eq!(
            check_bridge_mint(true, &tid, NS, true, ""),
            Err(KargainError::TokenExists)
        );
    }

    #[test]
    fn bridge_reset_empty_uri_does_not_adopt() {
        let tid = token_id_from_parts(NS, 7);
        let plan =
            check_bridge_reset_on_unlock(true, &tid, NS, true, Status::Verified, "").unwrap();
        assert!(plan.emit_verification_reset);
        assert!(!plan.adopt_uri);
        assert!(plan.clear_custody_lock);
    }

    #[test]
    fn gateway_bind_one_shot() {
        assert_eq!(
            check_set_bridge_gateway(true, false),
            Err(KargainError::GatewayAlreadySet)
        );
        assert!(check_set_bridge_gateway(false, false).is_ok());
    }

    #[test]
    fn staking_missing_is_not_active() {
        assert_eq!(
            check_active_verifier(None),
            Err(KargainError::NotActiveVerifier)
        );
    }
}
