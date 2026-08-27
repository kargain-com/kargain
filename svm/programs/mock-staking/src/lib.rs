//! Test-only staking stub — mirrors `contracts/test/MockKarProActive.sol`.
//!
//! Passport `verify` / judge paths read `is_active_verifier` at a derived
//! stake account. Missing or `active=false` → `NotActiveVerifier` (not unanswerable).

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub const STAKE_SEED: &[u8] = b"stake";
pub const ACTIVE_DISCRIMINATOR: [u8; 8] = *b"m_stake\0";

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct ActiveRecord {
    pub discriminator: [u8; 8],
    pub wallet: [u8; 32],
    pub active: bool,
    pub bump: u8,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub enum MockStakingIx {
    /// Create or update `[STAKE_SEED, wallet]` active flag.
    SetActive { wallet: [u8; 32], active: bool },
}

pub fn stake_pda(program_id: &Pubkey, wallet: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[STAKE_SEED, wallet], program_id)
}

/// Host helper — same predicate passport uses.
pub fn is_active_verifier(record: Option<&ActiveRecord>) -> bool {
    matches!(record, Some(r) if r.discriminator == ACTIVE_DISCRIMINATOR && r.active)
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let ix = MockStakingIx::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
    match ix {
        MockStakingIx::SetActive { wallet, active } => set_active(program_id, accounts, wallet, active),
    }
}

fn set_active(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    wallet: [u8; 32],
    active: bool,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let stake = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    let (expected, bump) = stake_pda(program_id, &wallet);
    if stake.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let record = ActiveRecord {
        discriminator: ACTIVE_DISCRIMINATOR,
        wallet,
        active,
        bump,
    };
    let space = borsh::to_vec(&record)
        .map_err(|_| ProgramError::InvalidAccountData)?
        .len();

    if stake.data_is_empty() || stake.lamports() == 0 {
        let lamports = Rent::get()?.minimum_balance(space);
        solana_program::program::invoke_signed(
            &system_instruction::create_account(
                payer.key,
                stake.key,
                lamports,
                space as u64,
                program_id,
            ),
            &[payer.clone(), stake.clone(), system.clone()],
            &[&[STAKE_SEED, &wallet, &[bump]]],
        )?;
    }

    let mut data = stake.try_borrow_mut_data()?;
    let encoded = borsh::to_vec(&record).map_err(|_| ProgramError::InvalidAccountData)?;
    if data.len() < encoded.len() {
        return Err(ProgramError::AccountDataTooSmall);
    }
    data[..encoded.len()].copy_from_slice(&encoded);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_is_inactive() {
        assert!(!is_active_verifier(None));
    }

    #[test]
    fn false_is_inactive() {
        let r = ActiveRecord {
            discriminator: ACTIVE_DISCRIMINATOR,
            wallet: [1u8; 32],
            active: false,
            bump: 1,
        };
        assert!(!is_active_verifier(Some(&r)));
    }

    #[test]
    fn true_is_active() {
        let r = ActiveRecord {
            discriminator: ACTIVE_DISCRIMINATOR,
            wallet: [1u8; 32],
            active: true,
            bump: 1,
        };
        assert!(is_active_verifier(Some(&r)));
    }
}
