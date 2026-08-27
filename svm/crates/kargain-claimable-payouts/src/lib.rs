//! Claimable payouts — mirror of `contracts/lib/ClaimablePayouts.sol`.
//!
//! Amounts are tracked in stored pending/locked state, never inferred from
//! account lamports (D-04), except `rescue_excess` which must read lamports
//! to know excess over `total_locked_bonds + total_pending_native`.

use borsh::{BorshDeserialize, BorshSerialize};
use kargain_errors::KargainError;
use std::collections::BTreeMap;

/// Native asset sentinel (EVM `address(0)`).
pub const NATIVE_ASSET: [u8; 32] = [0u8; 32];

#[derive(Debug, Clone, Default, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct ClaimablePayoutsState {
    /// account => asset => credited amount
    pub pending: BTreeMap<[u8; 32], BTreeMap<[u8; 32], u64>>,
    pub total_pending_native: u64,
    pub total_pending_by_asset: BTreeMap<[u8; 32], u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PayoutEvent {
    ClaimRecorded {
        account: [u8; 32],
        asset: [u8; 32],
        amount: u64,
    },
    ClaimWithdrawn {
        account: [u8; 32],
        asset: [u8; 32],
        amount: u64,
    },
}

impl ClaimablePayoutsState {
    pub fn pending_claims(&self, account: &[u8; 32], asset: &[u8; 32]) -> u64 {
        self.pending
            .get(account)
            .and_then(|m| m.get(asset))
            .copied()
            .unwrap_or(0)
    }

    pub fn credit_claim(
        &mut self,
        account: [u8; 32],
        asset: [u8; 32],
        amount: u64,
    ) -> Option<PayoutEvent> {
        if amount == 0 {
            return None;
        }
        let entry = self
            .pending
            .entry(account)
            .or_default()
            .entry(asset)
            .or_insert(0);
        *entry = entry.saturating_add(amount);
        if asset == NATIVE_ASSET {
            self.total_pending_native = self.total_pending_native.saturating_add(amount);
        } else {
            *self.total_pending_by_asset.entry(asset).or_insert(0) =
                self.total_pending_by_asset
                    .get(&asset)
                    .copied()
                    .unwrap_or(0)
                    .saturating_add(amount);
        }
        Some(PayoutEvent::ClaimRecorded {
            account,
            asset,
            amount,
        })
    }

    /// Attempt native payout. On failure, credit a claim (I5).
    pub fn pay_native(
        &mut self,
        to: [u8; 32],
        amount: u64,
        push_ok: bool,
    ) -> Option<PayoutEvent> {
        if amount == 0 {
            return None;
        }
        if push_ok {
            return None;
        }
        self.credit_claim(to, NATIVE_ASSET, amount)
    }

    /// CEI withdraw of caller's claim.
    pub fn withdraw_claim(
        &mut self,
        caller: [u8; 32],
        asset: [u8; 32],
        transfer_ok: bool,
    ) -> Result<PayoutEvent, KargainError> {
        let amount = self.pending_claims(&caller, &asset);
        if amount == 0 {
            return Err(KargainError::NoClaim);
        }
        self.pending
            .get_mut(&caller)
            .and_then(|m| m.remove(&asset));
        if asset == NATIVE_ASSET {
            self.total_pending_native = self.total_pending_native.saturating_sub(amount);
        } else if let Some(t) = self.total_pending_by_asset.get_mut(&asset) {
            *t = t.saturating_sub(amount);
        }
        if !transfer_ok {
            // Restore on failure — EVM reverts TransferFailed after zeroing;
            // we mirror by returning error (caller must not commit).
            return Err(KargainError::TransferFailed);
        }
        Ok(PayoutEvent::ClaimWithdrawn {
            account: caller,
            asset,
            amount,
        })
    }

    /// Free balance available to rescue = lamports − locked − pending native.
    pub fn rescue_excessable(
        &self,
        account_lamports: u64,
        total_locked_bonds: u64,
        amount: u64,
    ) -> Result<u64, KargainError> {
        let locked = total_locked_bonds.saturating_add(self.total_pending_native);
        let free = account_lamports.saturating_sub(locked);
        if amount == 0 || amount > free {
            return Err(KargainError::NothingToRescue);
        }
        Ok(amount)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_push_credits_claim() {
        let mut s = ClaimablePayoutsState::default();
        let to = [1u8; 32];
        let ev = s.pay_native(to, 100, false).unwrap();
        assert_eq!(
            ev,
            PayoutEvent::ClaimRecorded {
                account: to,
                asset: NATIVE_ASSET,
                amount: 100
            }
        );
        assert_eq!(s.pending_claims(&to, &NATIVE_ASSET), 100);
        assert_eq!(s.total_pending_native, 100);
    }

    #[test]
    fn withdraw_requires_claim() {
        let mut s = ClaimablePayoutsState::default();
        assert_eq!(
            s.withdraw_claim([1u8; 32], NATIVE_ASSET, true),
            Err(KargainError::NoClaim)
        );
    }

    #[test]
    fn withdraw_transfer_failed() {
        let mut s = ClaimablePayoutsState::default();
        let acct = [1u8; 32];
        s.credit_claim(acct, NATIVE_ASSET, 50).unwrap();
        assert_eq!(
            s.withdraw_claim(acct, NATIVE_ASSET, false),
            Err(KargainError::TransferFailed)
        );
    }
}
