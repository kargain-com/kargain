//! Native claim withdraw — asset `[0u8; 32]` mirrors EVM `address(0)`.

use borsh::{BorshDeserialize, BorshSerialize};
use kargain_claimable_payouts::{
    claim_pda, withdraw_claim, withdraw_claim_prepare, ClaimAccount,
};
use kargain_claimable_payouts::emit::{emit_payout, PayoutEmitter};
use kargain_errors::KargainError;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
    system_program,
};

use crate::account::into_program_error;

/// Sentinel mint for native lamport claims (EVM `address(0)`).
pub fn native_claim_asset() -> Pubkey {
    Pubkey::default()
}

/// Accounts: recipient (signer), claim PDA, system program.
pub fn withdraw_claim_ix(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let recipient = next_account_info(iter)?;
    let claim_info = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !recipient.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if system.key != &system_program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    let mint = native_claim_asset();
    let (claim_key, _claim_bump) = claim_pda(program_id, recipient.key, &mint);
    if claim_info.key != &claim_key {
        return Err(ProgramError::InvalidSeeds);
    }
    if claim_info.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    let mut claim = {
        let data = claim_info.try_borrow_data()?;
        ClaimAccount::try_from_slice(&data).map_err(|_| ProgramError::InvalidAccountData)?
    };

    let amount = withdraw_claim_prepare(&claim).map_err(into_program_error)?;

    let ev = withdraw_claim(&mut claim, |withdraw_amount| {
        if withdraw_amount != amount {
            return Err(into_program_error(KargainError::TransferFailed));
        }
        let claim_lamports = claim_info.lamports();
        if claim_lamports < withdraw_amount {
            return Err(into_program_error(KargainError::TransferFailed));
        }
        **claim_info.try_borrow_mut_lamports()? -= withdraw_amount;
        **recipient.try_borrow_mut_lamports()? = recipient
            .lamports()
            .checked_add(withdraw_amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        Ok(())
    })?;

    emit_payout(PayoutEmitter::KarPassport, &ev);

    {
        let mut data = claim_info.try_borrow_mut_data()?;
        claim
            .serialize(&mut &mut data[..])
            .map_err(|_| ProgramError::AccountDataTooSmall)?;
    }

    if claim.amount == 0 {
        let rent_remaining = claim_info.lamports();
        if rent_remaining > 0 {
            **claim_info.try_borrow_mut_lamports()? = 0;
            **recipient.try_borrow_mut_lamports()? = recipient
                .lamports()
                .checked_add(rent_remaining)
                .ok_or(ProgramError::ArithmeticOverflow)?;
        }
        claim_info.try_borrow_mut_data()?.fill(0);
        claim_info.assign(&system_program::ID);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_asset_is_default_pubkey() {
        assert_eq!(native_claim_asset(), Pubkey::default());
    }
}
