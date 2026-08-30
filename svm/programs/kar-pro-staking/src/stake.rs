//! Answer-account proof for active-verifier status (passport consume).
//!
//! Four checks: owner program, discriminator+length, PDA re-derive from signer,
//! `active == true`. Mismatch on 1–3 → SourceUnanswerable; inactive → NotActiveVerifier.

use kargain_errors::KargainError;
use solana_program::pubkey::Pubkey;

use crate::seeds::stake_pda;
use crate::state::{StakeAccount, STAKE_DISCRIMINATOR};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StakeAnswerView {
    Active,
    Inactive,
    Unanswerable,
}

/// Host/unit helper — same predicate passport uses on-chain.
pub fn classify_stake_answer(
    data: Option<&[u8]>,
    expected_wallet: &[u8; 32],
    owned_by_staking_program: bool,
    account_key: Option<&Pubkey>,
    staking_program: &Pubkey,
) -> StakeAnswerView {
    if !owned_by_staking_program {
        return StakeAnswerView::Unanswerable;
    }
    let Some(raw) = data else {
        return StakeAnswerView::Unanswerable;
    };
    let Ok(stake) = borsh::BorshDeserialize::try_from_slice(raw) as Result<StakeAccount, _> else {
        return StakeAnswerView::Unanswerable;
    };
    if stake.discriminator != STAKE_DISCRIMINATOR {
        return StakeAnswerView::Unanswerable;
    }
    if stake.wallet != *expected_wallet {
        return StakeAnswerView::Unanswerable;
    }
    if let Some(key) = account_key {
        let (expected, _) = stake_pda(staking_program, expected_wallet);
        if key != &expected {
            return StakeAnswerView::Unanswerable;
        }
    }
    if stake.active {
        StakeAnswerView::Active
    } else {
        StakeAnswerView::Inactive
    }
}

pub fn prove_active_verifier(
    data: Option<&[u8]>,
    expected_wallet: &[u8; 32],
    owned_by_staking_program: bool,
    account_key: Option<&Pubkey>,
    staking_program: &Pubkey,
) -> Result<(), KargainError> {
    match classify_stake_answer(
        data,
        expected_wallet,
        owned_by_staking_program,
        account_key,
        staking_program,
    ) {
        StakeAnswerView::Active => Ok(()),
        StakeAnswerView::Inactive => Err(KargainError::NotActiveVerifier),
        StakeAnswerView::Unanswerable => Err(KargainError::SourceUnanswerable),
    }
}

pub fn is_active_verifier_record(stake: Option<&StakeAccount>) -> bool {
    matches!(stake, Some(s) if s.discriminator == STAKE_DISCRIMINATOR && s.active)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::StakeAccount;

    fn sample_active(wallet: [u8; 32]) -> StakeAccount {
        StakeAccount {
            discriminator: STAKE_DISCRIMINATOR,
            wallet,
            amount: 1,
            staked_at: 1,
            active: true,
            unlock_at: 0,
            verification_fee: 0,
            bump: 255,
        }
    }

    #[test]
    fn wrong_owner_unanswerable() {
        let w = [1u8; 32];
        let encoded = borsh::to_vec(&sample_active(w)).unwrap();
        let pid = Pubkey::new_unique();
        assert_eq!(
            prove_active_verifier(Some(&encoded), &w, false, None, &pid),
            Err(KargainError::SourceUnanswerable)
        );
    }

    #[test]
    fn wrong_pda_key_unanswerable() {
        let w = [2u8; 32];
        let encoded = borsh::to_vec(&sample_active(w)).unwrap();
        let pid = Pubkey::new_unique();
        let wrong = Pubkey::new_unique();
        assert_eq!(
            prove_active_verifier(Some(&encoded), &w, true, Some(&wrong), &pid),
            Err(KargainError::SourceUnanswerable)
        );
    }

    #[test]
    fn inactive_not_active_verifier() {
        let w = [3u8; 32];
        let mut s = sample_active(w);
        s.active = false;
        s.unlock_at = 99;
        let encoded = borsh::to_vec(&s).unwrap();
        let pid = Pubkey::new_unique();
        let (key, _) = stake_pda(&pid, &w);
        assert_eq!(
            prove_active_verifier(Some(&encoded), &w, true, Some(&key), &pid),
            Err(KargainError::NotActiveVerifier)
        );
    }

    #[test]
    fn active_ok() {
        let w = [4u8; 32];
        let encoded = borsh::to_vec(&sample_active(w)).unwrap();
        let pid = Pubkey::new_unique();
        let (key, _) = stake_pda(&pid, &w);
        assert!(prove_active_verifier(Some(&encoded), &w, true, Some(&key), &pid).is_ok());
    }
}
