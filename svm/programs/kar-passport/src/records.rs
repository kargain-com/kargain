//! Rich passport records — append-only PDAs (SPEC §12.8 / D-10).

use borsh::BorshSerialize;
use kargain_errors::KargainError;
use kargain_events::generated;
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    system_program,
    sysvar::Sysvar,
};

use crate::account::into_program_error;
use crate::core_asset::{is_live_core_asset, read_owner};
use crate::custody::require_not_bridged_away;
use crate::seeds::{record_pda, RECORD_SEED};
use crate::state::{
    PassportRecord, PassportState, PASSPORT_RECORD_DISCRIMINATOR,
};
use kar_pro_staking::prove_active_verifier;

pub const RECORD_TYPE_DISCREPANCY: &str = "discrepancy";
pub const RECORD_TYPE_ATTESTATION: &str = "attestation";
pub const RECORD_TYPE_DISPUTE_WITHDRAWN: &str = "dispute_withdrawn";

/// Owner append — recordType + description required (Solidity `appendRecord`).
pub fn check_append_record(
    asset_exists: bool,
    burned: bool,
    custody_locked: bool,
    is_owner: bool,
    record_type: &str,
    description: &str,
) -> Result<(), KargainError> {
    require_exists(asset_exists, burned)?;
    require_not_bridged_away(custody_locked)?;
    if !is_owner {
        return Err(KargainError::NotOwner);
    }
    if record_type.is_empty() || description.is_empty() {
        return Err(KargainError::EmptyField);
    }
    Ok(())
}

/// Permissionless discrepancy report.
pub fn check_report_discrepancy(
    asset_exists: bool,
    burned: bool,
    custody_locked: bool,
    description: &str,
) -> Result<(), KargainError> {
    require_exists(asset_exists, burned)?;
    require_not_bridged_away(custody_locked)?;
    if description.is_empty() {
        return Err(KargainError::EmptyField);
    }
    Ok(())
}

/// Active verifier attestation.
pub fn check_append_attestation(
    asset_exists: bool,
    burned: bool,
    custody_locked: bool,
    description: &str,
    stake_data: Option<&[u8]>,
    stake_owned_by_staking: bool,
    stake_key: Option<&Pubkey>,
    attester: &Pubkey,
    staking_program: &Pubkey,
) -> Result<(), KargainError> {
    require_exists(asset_exists, burned)?;
    require_not_bridged_away(custody_locked)?;
    if description.is_empty() {
        return Err(KargainError::EmptyField);
    }
    prove_active_verifier(
        stake_data,
        &attester.to_bytes(),
        stake_owned_by_staking,
        stake_key,
        staking_program,
    )?;
    Ok(())
}

fn require_exists(asset_exists: bool, burned: bool) -> Result<(), KargainError> {
    if !asset_exists || burned {
        Err(KargainError::NonexistentToken)
    } else {
        Ok(())
    }
}

/// Build the next record row and return encoded size for rent.
pub fn build_record(
    token_id: [u8; 32],
    index: u32,
    timestamp: u64,
    author: [u8; 32],
    record_type: String,
    description: String,
    evidence_cid: String,
    bump: u8,
) -> Result<(PassportRecord, Vec<u8>), ProgramError> {
    let record = PassportRecord {
        discriminator: PASSPORT_RECORD_DISCRIMINATOR,
        token_id,
        index,
        timestamp,
        author,
        record_type,
        description,
        evidence_cid,
        bump,
    };
    let encoded = borsh::to_vec(&record).map_err(|_| ProgramError::InvalidAccountData)?;
    Ok((record, encoded))
}

pub fn emit_record_appended(
    token_id: [u8; 32],
    author: [u8; 32],
    record_type: &str,
    description: &str,
    evidence_cid: &str,
) {
    generated::emit_kar_passport_record_appended(
        token_id,
        author,
        record_type.to_string(),
        description.to_string(),
        evidence_cid.to_string(),
    );
}

pub fn create_record_account<'info>(
    program_id: &Pubkey,
    record: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    token_id: &[u8; 32],
    index: u32,
    encoded_len: usize,
    record_bump: u8,
) -> ProgramResult {
    if system.key != &system_program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (expected, _) = record_pda(program_id, token_id, index);
    if record.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if record.lamports() != 0 {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    let lamports = Rent::get()?.minimum_balance(encoded_len);
    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            record.key,
            lamports,
            encoded_len as u64,
            program_id,
        ),
        &[payer.clone(), record.clone(), system.clone()],
        &[&[RECORD_SEED, token_id, &index.to_le_bytes(), &[record_bump]]],
    )?;
    Ok(())
}

pub fn save_record(record_ai: &AccountInfo, encoded: &[u8]) -> ProgramResult {
    let mut data = record_ai.try_borrow_mut_data()?;
    if data.len() < encoded.len() {
        return Err(ProgramError::AccountDataTooSmall);
    }
    data[..encoded.len()].copy_from_slice(encoded);
    Ok(())
}

/// Shared on-chain append after gates pass.
pub fn append_record_checked<'info>(
    program_id: &Pubkey,
    asset: &AccountInfo<'info>,
    state: &mut PassportState,
    record_ai: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    author: [u8; 32],
    record_type: String,
    description: String,
    evidence_cid: String,
    timestamp: u64,
) -> ProgramResult {
    let index = state.record_count;
    let (record_key, record_bump) = record_pda(program_id, &state.token_id, index);
    if record_ai.key != &record_key {
        return Err(ProgramError::InvalidSeeds);
    }
    let (_record, encoded) = build_record(
        state.token_id,
        index,
        timestamp,
        author,
        record_type.clone(),
        description.clone(),
        evidence_cid.clone(),
        record_bump,
    )?;
    create_record_account(
        program_id,
        record_ai,
        payer,
        system,
        &state.token_id,
        index,
        encoded.len(),
        record_bump,
    )?;
    save_record(record_ai, &encoded)?;
    state.record_count = state
        .record_count
        .checked_add(1)
        .ok_or(into_program_error(KargainError::ArithmeticOverflow))?;
    emit_record_appended(
        state.token_id,
        author,
        &record_type,
        &description,
        &evidence_cid,
    );
    let _ = asset;
    Ok(())
}

pub fn gate_and_read_owner(asset: &AccountInfo) -> Result<(bool, Pubkey), ProgramError> {
    let live = is_live_core_asset(asset);
    if !live {
        return Ok((false, Pubkey::default()));
    }
    Ok((true, read_owner(asset)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_record_requires_owner_and_fields() {
        assert!(check_append_record(
            true,
            false,
            false,
            true,
            "service",
            "desc"
        )
        .is_ok());
        assert_eq!(
            check_append_record(true, false, false, false, "t", "d"),
            Err(KargainError::NotOwner)
        );
        assert_eq!(
            check_append_record(true, false, false, true, "", "d"),
            Err(KargainError::EmptyField)
        );
        assert_eq!(
            check_append_record(true, false, true, true, "t", "d"),
            Err(KargainError::PassportBridgedAway)
        );
        assert_eq!(
            check_append_record(false, false, false, true, "t", "d"),
            Err(KargainError::NonexistentToken)
        );
    }

    #[test]
    fn report_discrepancy_permissionless_but_not_away() {
        assert!(check_report_discrepancy(true, false, false, "issue").is_ok());
        assert_eq!(
            check_report_discrepancy(true, false, false, ""),
            Err(KargainError::EmptyField)
        );
        assert_eq!(
            check_report_discrepancy(true, true, false, "x"),
            Err(KargainError::NonexistentToken)
        );
    }

    #[test]
    fn build_record_roundtrip() {
        let (rec, enc) = build_record(
            [1u8; 32],
            0,
            99,
            [2u8; 32],
            "discrepancy".to_string(),
            "desc".to_string(),
            "cid".to_string(),
            255,
        )
        .unwrap();
        assert_eq!(rec.index, 0);
        assert!(!enc.is_empty());
    }
}
