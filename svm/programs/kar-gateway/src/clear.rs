//! Endpoint `clear` must run before any Kargain state mutation on receive.
//!
//! Host-visible sequencing helper; the gateway entrypoint CPI-orders
//! `mock_endpoint::Clear` before any passport BridgeMint / BridgeReset.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReceivePhase {
    Cleared,
    StateMutated,
}

/// Enforce clear-before-state. Returns Err if state attempted first.
pub fn assert_clear_before_state(phases: &[ReceivePhase]) -> Result<(), &'static str> {
    let mut seen_clear = false;
    for p in phases {
        match p {
            ReceivePhase::Cleared => seen_clear = true,
            ReceivePhase::StateMutated if !seen_clear => {
                return Err("state mutation before endpoint clear");
            }
            ReceivePhase::StateMutated => {}
        }
    }
    if !seen_clear {
        return Err("missing endpoint clear");
    }
    Ok(())
}

/// Gateway LzReceive phase order (normative).
pub const LZ_RECEIVE_PHASE_ORDER: &[ReceivePhase] =
    &[ReceivePhase::Cleared, ReceivePhase::StateMutated];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clear_then_state_ok() {
        assert!(assert_clear_before_state(LZ_RECEIVE_PHASE_ORDER).is_ok());
    }

    #[test]
    fn state_first_refused() {
        assert!(assert_clear_before_state(&[ReceivePhase::StateMutated]).is_err());
    }

    #[test]
    fn missing_clear_refused() {
        assert!(assert_clear_before_state(&[]).is_err());
    }

    #[test]
    fn clear_only_ok() {
        assert!(assert_clear_before_state(&[ReceivePhase::Cleared]).is_ok());
    }
}
