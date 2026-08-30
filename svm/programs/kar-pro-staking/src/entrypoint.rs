//! BPF entrypoint — join / leave / claim / close pass.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    msg,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

use crate::account::into_program_error;
use crate::instruction::StakingIx;
use crate::seeds::{config_pda, stake_pda, CONFIG_SEED, STAKE_SEED};
use crate::state::{
    StakeAccount, StakingConfig, STAKE_DISCRIMINATOR, STAKING_CONFIG_DISCRIMINATOR,
};
use kargain_errors::KargainError;

/// Fixed stake PDA data space (never resized).
pub const STAKE_SPACE: usize = 128;

/// Wire-compatible with `kar_pro_pass::PassIx` (borsh enum order).
#[derive(BorshSerialize)]
enum PassIxWire {
    Initialize { staking_program: [u8; 32] },
    Mint {
        category: u8,
        name: String,
        metadata_uri: String,
    },
    ClosePass { holder: [u8; 32] },
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let ix = StakingIx::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
    match ix {
        StakingIx::Initialize {
            pass_program,
            min_stake_lamports,
            min_stake_floor_lamports,
            unbonding_period_secs,
        } => initialize(
            program_id,
            accounts,
            pass_program,
            min_stake_lamports,
            min_stake_floor_lamports,
            unbonding_period_secs,
        ),
        StakingIx::Join {
            amount,
            category,
            name,
            metadata_uri,
        } => join(
            program_id,
            accounts,
            amount,
            category,
            name,
            metadata_uri,
        ),
        StakingIx::Leave => leave(program_id, accounts),
        StakingIx::ClaimStake => claim_stake(program_id, accounts),
        StakingIx::SetVerificationFee { fee } => set_verification_fee(program_id, accounts, fee),
        StakingIx::SetMinStakeNative { lamports } => {
            set_min_stake_native(program_id, accounts, lamports)
        }
        StakingIx::ClosePass => close_pass(program_id, accounts),
    }
}

fn initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    pass_program: [u8; 32],
    min_stake_lamports: u64,
    min_stake_floor_lamports: u64,
    unbonding_period_secs: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let authority = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if pass_program == [0u8; 32] {
        return Err(into_program_error(KargainError::ZeroAddress));
    }
    if min_stake_lamports < min_stake_floor_lamports {
        return Err(into_program_error(KargainError::BelowMinStakeFloor));
    }
    let (expected, bump) = config_pda(program_id);
    if config.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if !config.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    let record = StakingConfig {
        discriminator: STAKING_CONFIG_DISCRIMINATOR,
        authority: authority.key.to_bytes(),
        pass_program,
        min_stake_lamports,
        min_stake_floor_lamports,
        unbonding_period_secs,
        bump,
    };
    let encoded = borsh::to_vec(&record).map_err(|_| ProgramError::InvalidAccountData)?;
    let lamports = Rent::get()?.minimum_balance(encoded.len());
    solana_program::program::invoke_signed(
        &system_instruction::create_account(
            authority.key,
            config.key,
            lamports,
            encoded.len() as u64,
            program_id,
        ),
        &[authority.clone(), config.clone(), system.clone()],
        &[&[CONFIG_SEED, &[bump]]],
    )?;
    config.try_borrow_mut_data()?[..encoded.len()].copy_from_slice(&encoded);
    msg!("kar-pro-staking Initialize ok");
    Ok(())
}

fn load_config(program_id: &Pubkey, config: &AccountInfo) -> Result<StakingConfig, ProgramError> {
    let (expected, _) = config_pda(program_id);
    if config.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if config.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let data = config.try_borrow_data()?;
    let cfg = StakingConfig::try_from_slice(&data).map_err(|_| ProgramError::InvalidAccountData)?;
    if cfg.discriminator != STAKING_CONFIG_DISCRIMINATOR {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(cfg)
}

fn load_stake(
    program_id: &Pubkey,
    stake: &AccountInfo,
    wallet: &[u8; 32],
) -> Result<StakeAccount, ProgramError> {
    let (expected, _) = stake_pda(program_id, wallet);
    if stake.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if stake.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let data = stake.try_borrow_data()?;
    // Fixed STAKE_SPACE may exceed borsh payload — do not use try_from_slice.
    let mut cursor: &[u8] = &data;
    let s = StakeAccount::deserialize(&mut cursor).map_err(|_| ProgramError::InvalidAccountData)?;
    if s.discriminator != STAKE_DISCRIMINATOR {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(s)
}

fn write_stake(stake: &AccountInfo, record: &StakeAccount) -> ProgramResult {
    let encoded = borsh::to_vec(record).map_err(|_| ProgramError::InvalidAccountData)?;
    let mut data = stake.try_borrow_mut_data()?;
    if data.len() < encoded.len() {
        return Err(ProgramError::AccountDataTooSmall);
    }
    data[..encoded.len()].copy_from_slice(&encoded);
    Ok(())
}

fn require_can_join(s: Option<&StakeAccount>) -> Result<(), ProgramError> {
    match s {
        Some(s) if s.active => Err(into_program_error(KargainError::AlreadyVerifier)),
        Some(s) if s.unlock_at != 0 || s.amount > 0 => {
            Err(into_program_error(KargainError::UnbondPending))
        }
        _ => Ok(()),
    }
}

fn join(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
    category: u8,
    name: String,
    metadata_uri: String,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let stake = next_account_info(iter)?;
    let verifier = next_account_info(iter)?;
    let pass_program_ai = next_account_info(iter)?;
    let pass_config = next_account_info(iter)?;
    let pass_asset = next_account_info(iter)?;
    let pass_meta = next_account_info(iter)?;
    let pass_freeze = next_account_info(iter)?;
    let core = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !verifier.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    if pass_program_ai.key.to_bytes() != cfg.pass_program {
        return Err(ProgramError::IncorrectProgramId);
    }
    if amount < cfg.min_stake_lamports {
        return Err(into_program_error(KargainError::BelowMinStake));
    }

    let wallet = verifier.key.to_bytes();
    let (stake_key, stake_bump) = stake_pda(program_id, &wallet);
    if stake.key != &stake_key {
        return Err(ProgramError::InvalidSeeds);
    }

    let existing = if stake.owner == program_id && !stake.data_is_empty() {
        Some(load_stake(program_id, stake, &wallet)?)
    } else {
        None
    };
    require_can_join(existing.as_ref())?;

    let rent = Rent::get()?.minimum_balance(STAKE_SPACE);
    if stake.data_is_empty() || stake.lamports() == 0 {
        solana_program::program::invoke_signed(
            &system_instruction::create_account(
                verifier.key,
                stake.key,
                rent.saturating_add(amount),
                STAKE_SPACE as u64,
                program_id,
            ),
            &[verifier.clone(), stake.clone(), system.clone()],
            &[&[STAKE_SEED, &wallet, &[stake_bump]]],
        )?;
    } else {
        invoke(
            &system_instruction::transfer(verifier.key, stake.key, amount),
            &[verifier.clone(), stake.clone(), system.clone()],
        )?;
    }

    let now = Clock::get()?.unix_timestamp as u64;
    let record = StakeAccount {
        discriminator: STAKE_DISCRIMINATOR,
        wallet,
        amount,
        staked_at: now,
        active: true,
        unlock_at: 0,
        verification_fee: 0,
        bump: stake_bump,
    };
    write_stake(stake, &record)?;

    let pass_data = borsh::to_vec(&PassIxWire::Mint {
        category,
        name,
        metadata_uri,
    })
    .map_err(|_| ProgramError::InvalidInstructionData)?;
    let pass_program = Pubkey::new_from_array(cfg.pass_program);
    let ix = Instruction {
        program_id: pass_program,
        accounts: vec![
            AccountMeta::new(*pass_config.key, false),
            AccountMeta::new_readonly(*config.key, true),
            AccountMeta::new_readonly(*verifier.key, false),
            AccountMeta::new(*pass_asset.key, false),
            AccountMeta::new(*pass_meta.key, false),
            AccountMeta::new_readonly(*pass_freeze.key, false),
            AccountMeta::new(*verifier.key, true),
            AccountMeta::new_readonly(*core.key, false),
            AccountMeta::new_readonly(*system.key, false),
        ],
        data: pass_data,
    };
    solana_program::program::invoke_signed(
        &ix,
        &[
            pass_config.clone(),
            config.clone(),
            verifier.clone(),
            pass_asset.clone(),
            pass_meta.clone(),
            pass_freeze.clone(),
            verifier.clone(),
            core.clone(),
            system.clone(),
            pass_program_ai.clone(),
        ],
        &[&[CONFIG_SEED, &[cfg.bump]]],
    )?;

    msg!("kar-pro-staking Join ok amount={}", amount);
    Ok(())
}

fn leave(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let stake = next_account_info(iter)?;
    let verifier = next_account_info(iter)?;
    if !verifier.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    let wallet = verifier.key.to_bytes();
    let mut s = load_stake(program_id, stake, &wallet)?;
    if !s.active {
        return Err(into_program_error(KargainError::NotVerifier));
    }
    let now = Clock::get()?.unix_timestamp as u64;
    let unlock_at = now.saturating_add(cfg.unbonding_period_secs);
    let amount = s.amount;
    s.active = false;
    s.unlock_at = unlock_at;
    s.verification_fee = 0;
    write_stake(stake, &s)?;
    msg!(
        "kar-pro-staking Leave amount={} unlock_at={}",
        amount,
        unlock_at
    );
    Ok(())
}

fn claim_stake(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let stake = next_account_info(iter)?;
    let verifier = next_account_info(iter)?;
    if !verifier.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let _cfg = load_config(program_id, config)?;
    let wallet = verifier.key.to_bytes();
    let mut s = load_stake(program_id, stake, &wallet)?;
    if s.active || s.unlock_at == 0 {
        return Err(into_program_error(KargainError::NoUnbond));
    }
    let now = Clock::get()?.unix_timestamp as u64;
    if now < s.unlock_at {
        return Err(into_program_error(KargainError::UnbondNotReady));
    }
    let amount = s.amount;
    let rent = Rent::get()?.minimum_balance(STAKE_SPACE);
    if stake.lamports() < rent.saturating_add(amount) {
        return Err(into_program_error(KargainError::TransferFailed));
    }
    **stake.try_borrow_mut_lamports()? = stake
        .lamports()
        .checked_sub(amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    **verifier.try_borrow_mut_lamports()? = verifier
        .lamports()
        .checked_add(amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    s.amount = 0;
    s.unlock_at = 0;
    s.staked_at = 0;
    write_stake(stake, &s)?;
    msg!("kar-pro-staking ClaimStake amount={}", amount);
    Ok(())
}

fn set_verification_fee(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    fee: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let stake = next_account_info(iter)?;
    let verifier = next_account_info(iter)?;
    if !verifier.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let _cfg = load_config(program_id, config)?;
    let wallet = verifier.key.to_bytes();
    let mut s = load_stake(program_id, stake, &wallet)?;
    if !s.active {
        return Err(into_program_error(KargainError::NotVerifier));
    }
    s.verification_fee = fee;
    write_stake(stake, &s)?;
    Ok(())
}

fn set_min_stake_native(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    lamports: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let authority = next_account_info(iter)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut cfg = load_config(program_id, config)?;
    if authority.key.to_bytes() != cfg.authority {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if lamports < cfg.min_stake_floor_lamports {
        return Err(into_program_error(KargainError::BelowMinStakeFloor));
    }
    cfg.min_stake_lamports = lamports;
    let encoded = borsh::to_vec(&cfg).map_err(|_| ProgramError::InvalidAccountData)?;
    config.try_borrow_mut_data()?[..encoded.len()].copy_from_slice(&encoded);
    Ok(())
}

fn close_pass(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let stake = next_account_info(iter)?;
    let verifier = next_account_info(iter)?;
    let pass_program_ai = next_account_info(iter)?;
    let pass_config = next_account_info(iter)?;
    let pass_asset = next_account_info(iter)?;
    let pass_meta = next_account_info(iter)?;
    let pass_freeze = next_account_info(iter)?;
    let rent_recipient = next_account_info(iter)?;
    let core = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !verifier.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    if pass_program_ai.key.to_bytes() != cfg.pass_program {
        return Err(ProgramError::IncorrectProgramId);
    }
    let wallet = verifier.key.to_bytes();
    let s = load_stake(program_id, stake, &wallet)?;
    if s.active {
        return Err(into_program_error(KargainError::AlreadyVerifier));
    }

    let pass_data = borsh::to_vec(&PassIxWire::ClosePass { holder: wallet })
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let pass_program = Pubkey::new_from_array(cfg.pass_program);
    let ix = Instruction {
        program_id: pass_program,
        accounts: vec![
            AccountMeta::new_readonly(*pass_config.key, false),
            AccountMeta::new_readonly(*config.key, true),
            AccountMeta::new(*pass_asset.key, false),
            AccountMeta::new(*pass_meta.key, false),
            AccountMeta::new_readonly(*pass_freeze.key, false),
            AccountMeta::new_readonly(*verifier.key, true),
            AccountMeta::new(*rent_recipient.key, false),
            AccountMeta::new(*verifier.key, true),
            AccountMeta::new_readonly(*core.key, false),
            AccountMeta::new_readonly(*system.key, false),
        ],
        data: pass_data,
    };
    solana_program::program::invoke_signed(
        &ix,
        &[
            pass_config.clone(),
            config.clone(),
            pass_asset.clone(),
            pass_meta.clone(),
            pass_freeze.clone(),
            verifier.clone(),
            rent_recipient.clone(),
            verifier.clone(),
            core.clone(),
            system.clone(),
            pass_program_ai.clone(),
        ],
        &[&[CONFIG_SEED, &[cfg.bump]]],
    )?;
    msg!("kar-pro-staking ClosePass ok");
    Ok(())
}
