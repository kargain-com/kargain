//! BPF entrypoint — initialize, mint, close pass.

use borsh::BorshDeserialize;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::Sysvar,
};

use crate::account::into_program_error;
use crate::core_asset::{create_pass_asset, is_live_core_asset, thaw_and_burn};
use crate::instruction::PassIx;
use crate::seeds::{
    config_pda, freeze_pda, pass_asset_pda, pass_meta_pda, CONFIG_SEED, PASS_META_SEED,
};
use crate::state::{
    PassConfig, PassMeta, MAX_CATEGORY, PASS_CONFIG_DISCRIMINATOR, PASS_META_DISCRIMINATOR,
};
use kargain_errors::{KargainError, PASSPORT_URI_CEILING_BYTES};

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let ix = PassIx::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
    match ix {
        PassIx::Initialize { staking_program } => initialize(program_id, accounts, staking_program),
        PassIx::Mint {
            category,
            name,
            metadata_uri,
        } => mint(program_id, accounts, category, name, metadata_uri),
        PassIx::ClosePass { holder } => close_pass(program_id, accounts, holder),
    }
}

fn initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    staking_program: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let authority = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if staking_program == [0u8; 32] {
        return Err(into_program_error(KargainError::ZeroAddress));
    }
    let (expected, bump) = config_pda(program_id);
    if config.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if !config.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    let record = PassConfig {
        discriminator: PASS_CONFIG_DISCRIMINATOR,
        authority: authority.key.to_bytes(),
        staking_program,
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
    // Ensure freeze PDA address is derived (account need not exist until first thaw).
    let _ = freeze_pda(program_id);
    msg!("kar-pro-pass Initialize ok");
    Ok(())
}

fn load_config(program_id: &Pubkey, config: &AccountInfo) -> Result<PassConfig, ProgramError> {
    let (expected, _) = config_pda(program_id);
    if config.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if config.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let data = config.try_borrow_data()?;
    let cfg = PassConfig::try_from_slice(&data).map_err(|_| ProgramError::InvalidAccountData)?;
    if cfg.discriminator != PASS_CONFIG_DISCRIMINATOR {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(cfg)
}

/// Staking authorizes mint/close by signing with its config PDA (CPI invoke_signed).
fn require_staking_signer(
    cfg: &PassConfig,
    staking_config: &AccountInfo,
) -> Result<(), ProgramError> {
    if !staking_config.is_signer {
        return Err(into_program_error(KargainError::OnlyStaking));
    }
    let staking_program = Pubkey::new_from_array(cfg.staking_program);
    let (expected, _) = Pubkey::find_program_address(&[b"config"], &staking_program);
    if staking_config.key != &expected {
        return Err(into_program_error(KargainError::OnlyStaking));
    }
    if staking_config.owner != &staking_program {
        return Err(into_program_error(KargainError::OnlyStaking));
    }
    Ok(())
}

fn mint(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    category: u8,
    name: String,
    metadata_uri: String,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let staking_config = next_account_info(iter)?;
    let holder = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let meta = next_account_info(iter)?;
    let freeze = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let core = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    let cfg = load_config(program_id, config)?;
    require_staking_signer(&cfg, staking_config)?;
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if name.is_empty() || metadata_uri.is_empty() {
        return Err(into_program_error(KargainError::EmptyField));
    }
    if metadata_uri.len() > PASSPORT_URI_CEILING_BYTES {
        return Err(into_program_error(KargainError::UriTooLong));
    }
    if category > MAX_CATEGORY {
        return Err(into_program_error(KargainError::InvalidCategory));
    }

    let holder_bytes = holder.key.to_bytes();
    let (asset_key, asset_bump) = pass_asset_pda(program_id, &holder_bytes);
    if asset.key != &asset_key {
        return Err(ProgramError::InvalidSeeds);
    }
    if is_live_core_asset(asset) {
        return Err(into_program_error(KargainError::AlreadyHoldsPass));
    }

    let (meta_key, meta_bump) = pass_meta_pda(program_id, &holder_bytes);
    if meta.key != &meta_key {
        return Err(ProgramError::InvalidSeeds);
    }
    if !meta.data_is_empty() && meta.lamports() > 0 {
        return Err(into_program_error(KargainError::AlreadyHoldsPass));
    }

    let (freeze_key, _) = freeze_pda(program_id);
    if freeze.key != &freeze_key {
        return Err(ProgramError::InvalidSeeds);
    }

    create_pass_asset(
        program_id,
        asset,
        payer,
        holder,
        config,
        &freeze_key,
        core,
        system,
        &holder_bytes,
        name.clone(),
        metadata_uri.clone(),
        asset_bump,
        cfg.bump,
    )?;

    let issued_at = Clock::get()?.unix_timestamp as u64;
    let record = PassMeta {
        discriminator: PASS_META_DISCRIMINATOR,
        holder: holder_bytes,
        category,
        name,
        metadata_uri,
        issued_at,
        bump: meta_bump,
    };
    let encoded = borsh::to_vec(&record).map_err(|_| ProgramError::InvalidAccountData)?;
    let rent = Rent::get()?.minimum_balance(encoded.len());
    if meta.data_is_empty() || meta.lamports() == 0 {
        solana_program::program::invoke_signed(
            &system_instruction::create_account(
                payer.key,
                meta.key,
                rent,
                encoded.len() as u64,
                program_id,
            ),
            &[payer.clone(), meta.clone(), system.clone()],
            &[&[PASS_META_SEED, &holder_bytes, &[meta_bump]]],
        )?;
    }
    meta.try_borrow_mut_data()?[..encoded.len()].copy_from_slice(&encoded);
    msg!("kar-pro-pass Mint ok");
    Ok(())
}

fn close_pass(program_id: &Pubkey, accounts: &[AccountInfo], holder: [u8; 32]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let staking_config = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let meta = next_account_info(iter)?;
    let freeze = next_account_info(iter)?;
    let holder_ai = next_account_info(iter)?;
    let rent_recipient = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let core = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    let cfg = load_config(program_id, config)?;
    require_staking_signer(&cfg, staking_config)?;
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if holder_ai.key.to_bytes() != holder {
        return Err(ProgramError::InvalidArgument);
    }

    let (asset_key, _) = pass_asset_pda(program_id, &holder);
    if asset.key != &asset_key {
        return Err(ProgramError::InvalidSeeds);
    }
    if !is_live_core_asset(asset) {
        return Err(into_program_error(KargainError::DoesNotHoldPass));
    }

    let (freeze_key, freeze_bump) = freeze_pda(program_id);
    if freeze.key != &freeze_key {
        return Err(ProgramError::InvalidSeeds);
    }

    thaw_and_burn(
        asset,
        payer,
        holder_ai,
        freeze,
        freeze_bump,
        core,
        system,
    )?;

    let (meta_key, _) = pass_meta_pda(program_id, &holder);
    if meta.key == &meta_key && meta.owner == program_id && !meta.data_is_empty() {
        let lamports = meta.lamports();
        **meta.try_borrow_mut_lamports()? = 0;
        **rent_recipient.try_borrow_mut_lamports()? = rent_recipient
            .lamports()
            .checked_add(lamports)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        meta.try_borrow_mut_data()?.fill(0);
        meta.assign(&system_program::ID);
    }

    msg!("kar-pro-pass ClosePass ok");
    Ok(())
}
