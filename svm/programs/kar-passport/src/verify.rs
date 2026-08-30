//! `verify_passport` — active-verifier answer-account + self-verify refuse.

use kargain_errors::KargainError;
use kar_pro_staking::prove_active_verifier;
use solana_program::pubkey::Pubkey;

use crate::state::Status;

/// Pure verify gate (host + on-chain). Stake proof supplied by caller.
pub fn check_verify_passport(
    asset_exists: bool,
    custody_locked: bool,
    burned: bool,
    status: Status,
    asset_owner: &Pubkey,
    verifier: &Pubkey,
    stake_data: Option<&[u8]>,
    stake_owned_by_staking: bool,
    stake_key: Option<&Pubkey>,
    staking_program: &Pubkey,
) -> Result<(), KargainError> {
    if !asset_exists || burned {
        return Err(KargainError::NonexistentToken);
    }
    if custody_locked {
        return Err(KargainError::PassportBridgedAway);
    }
    let verifier_bytes = verifier.to_bytes();
    prove_active_verifier(
        stake_data,
        &verifier_bytes,
        stake_owned_by_staking,
        stake_key,
        staking_program,
    )?;
    if asset_owner == verifier {
        return Err(KargainError::CannotSelfVerify);
    }
    if status != Status::Unverified {
        return Err(KargainError::InvalidStatus);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use kar_pro_staking::{stake_pda, StakeAccount, STAKE_DISCRIMINATOR};

    fn active_stake(wallet: [u8; 32]) -> Vec<u8> {
        borsh::to_vec(&StakeAccount {
            discriminator: STAKE_DISCRIMINATOR,
            wallet,
            amount: 1,
            staked_at: 1,
            active: true,
            unlock_at: 0,
            verification_fee: 0,
            bump: 255,
        })
        .unwrap()
    }

    #[test]
    fn happy_path() {
        let staking = Pubkey::new_unique();
        let verifier = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let w = verifier.to_bytes();
        let data = active_stake(w);
        let (key, _) = stake_pda(&staking, &w);
        assert!(check_verify_passport(
            true,
            false,
            false,
            Status::Unverified,
            &owner,
            &verifier,
            Some(&data),
            true,
            Some(&key),
            &staking,
        )
        .is_ok());
    }

    #[test]
    fn self_verify_refused() {
        let staking = Pubkey::new_unique();
        let verifier = Pubkey::new_unique();
        let w = verifier.to_bytes();
        let data = active_stake(w);
        let (key, _) = stake_pda(&staking, &w);
        assert_eq!(
            check_verify_passport(
                true,
                false,
                false,
                Status::Unverified,
                &verifier,
                &verifier,
                Some(&data),
                true,
                Some(&key),
                &staking,
            ),
            Err(KargainError::CannotSelfVerify)
        );
    }

    #[test]
    fn wrong_owner_program_unanswerable() {
        let staking = Pubkey::new_unique();
        let verifier = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let w = verifier.to_bytes();
        let data = active_stake(w);
        let (key, _) = stake_pda(&staking, &w);
        assert_eq!(
            check_verify_passport(
                true,
                false,
                false,
                Status::Unverified,
                &owner,
                &verifier,
                Some(&data),
                false,
                Some(&key),
                &staking,
            ),
            Err(KargainError::SourceUnanswerable)
        );
    }

    #[test]
    fn wrong_pda_unanswerable() {
        let staking = Pubkey::new_unique();
        let verifier = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let w = verifier.to_bytes();
        let data = active_stake(w);
        let wrong = Pubkey::new_unique();
        assert_eq!(
            check_verify_passport(
                true,
                false,
                false,
                Status::Unverified,
                &owner,
                &verifier,
                Some(&data),
                true,
                Some(&wrong),
                &staking,
            ),
            Err(KargainError::SourceUnanswerable)
        );
    }

    #[test]
    fn inactive_mid_unbond() {
        let staking = Pubkey::new_unique();
        let verifier = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let w = verifier.to_bytes();
        let data = borsh::to_vec(&StakeAccount {
            discriminator: STAKE_DISCRIMINATOR,
            wallet: w,
            amount: 1,
            staked_at: 1,
            active: false,
            unlock_at: 99,
            verification_fee: 0,
            bump: 255,
        })
        .unwrap();
        let (key, _) = stake_pda(&staking, &w);
        assert_eq!(
            check_verify_passport(
                true,
                false,
                false,
                Status::Unverified,
                &owner,
                &verifier,
                Some(&data),
                true,
                Some(&key),
                &staking,
            ),
            Err(KargainError::NotActiveVerifier)
        );
    }

    #[test]
    fn invalid_status() {
        let staking = Pubkey::new_unique();
        let verifier = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let w = verifier.to_bytes();
        let data = active_stake(w);
        let (key, _) = stake_pda(&staking, &w);
        assert_eq!(
            check_verify_passport(
                true,
                false,
                false,
                Status::Verified,
                &owner,
                &verifier,
                Some(&data),
                true,
                Some(&key),
                &staking,
            ),
            Err(KargainError::InvalidStatus)
        );
    }

    #[test]
    fn left_then_rejoined_verify_ok() {
        let staking = Pubkey::new_unique();
        let verifier = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let w = verifier.to_bytes();
        let inactive = borsh::to_vec(&StakeAccount {
            discriminator: STAKE_DISCRIMINATOR,
            wallet: w,
            amount: 1,
            staked_at: 1,
            active: false,
            unlock_at: 99,
            verification_fee: 0,
            bump: 255,
        })
        .unwrap();
        let (key, _) = stake_pda(&staking, &w);
        assert_eq!(
            check_verify_passport(
                true,
                false,
                false,
                Status::Unverified,
                &owner,
                &verifier,
                Some(&inactive),
                true,
                Some(&key),
                &staking,
            ),
            Err(KargainError::NotActiveVerifier)
        );
        let active = active_stake(w);
        assert!(check_verify_passport(
            true,
            false,
            false,
            Status::Unverified,
            &owner,
            &verifier,
            Some(&active),
            true,
            Some(&key),
            &staking,
        )
        .is_ok());
    }
}
