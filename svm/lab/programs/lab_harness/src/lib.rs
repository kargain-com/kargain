//! S3 laboratory harness.
//!
//! Proves Metaplex Core substrate facts before Kargain programs exist:
//! - П-1: PDA can sign as the asset account at CreateV1 (`invoke_signed`)
//! - П-3: a program-id Address may be recorded as PermanentFreeze authority
//! - Freeze: thaw + burn in one instruction (authority = program PDA)

use borsh::{BorshDeserialize, BorshSerialize};
use mpl_core::{
    instructions::{BurnV1CpiBuilder, CreateV1CpiBuilder, UpdatePluginV1CpiBuilder},
    types::{
        DataState, PermanentFreezeDelegate, Plugin, PluginAuthority, PluginAuthorityPair,
        TransferDelegate,
    },
};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    system_program,
    sysvar::{rent::Rent, Sysvar},
};

entrypoint!(process_instruction);

pub const ASSET_SEED: &[u8] = b"lab_asset";
pub const STATE_SEED: &[u8] = b"lab_state";
/// Freeze authority PDA — production shape (program cannot ed25519-sign as itself).
pub const FREEZE_SEED: &[u8] = b"lab_freeze";

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub enum LabIx {
    /// Create Core asset at PDA `[ASSET_SEED, token_id]` with permanent freeze
    /// `frozen=false`. Freeze authority = freeze PDA; also records program_id
    /// as update authority via the update_authority account when provided.
    CreatePdaAsset { token_id: [u8; 32], uri: String },
    /// Same as CreatePdaAsset but frozen=true + TransferDelegate present.
    CreateFrozenWithDelegate { token_id: [u8; 32], uri: String },
    /// Create with PermanentFreeze authority = *this program id* (П-3 address shape).
    CreateWithProgramFreezeAuth { token_id: [u8; 32], uri: String },
    /// Freeze PDA thaws then owner burns in the same instruction.
    ThawAndBurn { token_id: [u8; 32] },
}

pub fn asset_pda(program_id: &Pubkey, token_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[ASSET_SEED, token_id], program_id)
}

pub fn state_pda(program_id: &Pubkey, token_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[STATE_SEED, token_id], program_id)
}

pub fn freeze_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[FREEZE_SEED], program_id)
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let ix = LabIx::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
    match ix {
        LabIx::CreatePdaAsset { token_id, uri } => {
            create_pda_asset(program_id, accounts, token_id, uri, false, false, false)
        }
        LabIx::CreateFrozenWithDelegate { token_id, uri } => {
            create_pda_asset(program_id, accounts, token_id, uri, true, true, false)
        }
        LabIx::CreateWithProgramFreezeAuth { token_id, uri } => {
            create_pda_asset(program_id, accounts, token_id, uri, false, false, true)
        }
        LabIx::ThawAndBurn { token_id } => thaw_and_burn(program_id, accounts, token_id),
    }
}

fn create_pda_asset(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    uri: String,
    frozen: bool,
    with_transfer_delegate: bool,
    freeze_auth_is_program: bool,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let asset = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let owner = next_account_info(iter)?;
    let freeze_authority_acct = next_account_info(iter)?;
    let core_program = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let state = next_account_info(iter).ok();

    let (expected, bump) = asset_pda(program_id, &token_id);
    if asset.key != &expected {
        msg!("asset PDA mismatch");
        return Err(ProgramError::InvalidSeeds);
    }
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if core_program.key != &mpl_core::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if system.key != &system_program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    let freeze_authority_key = if freeze_auth_is_program {
        *program_id
    } else {
        let (fk, _) = freeze_pda(program_id);
        if freeze_authority_acct.key != &fk {
            msg!("freeze PDA mismatch");
            return Err(ProgramError::InvalidSeeds);
        }
        fk
    };

    let mut plugins = vec![PluginAuthorityPair {
        plugin: Plugin::PermanentFreezeDelegate(PermanentFreezeDelegate { frozen }),
        authority: Some(PluginAuthority::Address {
            address: freeze_authority_key,
        }),
    }];
    if with_transfer_delegate {
        plugins.push(PluginAuthorityPair {
            plugin: Plugin::TransferDelegate(TransferDelegate {}),
            authority: Some(PluginAuthority::Address {
                address: *program_id,
            }),
        });
    }

    let seeds: &[&[u8]] = &[ASSET_SEED, &token_id, &[bump]];
    CreateV1CpiBuilder::new(core_program)
        .asset(asset)
        .payer(payer)
        .owner(Some(owner))
        .update_authority(Some(payer)) // payer is provisional; passport will use program PDA
        .system_program(system)
        .data_state(DataState::AccountState)
        .name("lab".to_string())
        .uri(uri)
        .plugins(plugins)
        .invoke_signed(&[seeds])?;

    if let Some(state) = state {
        let (state_key, state_bump) = state_pda(program_id, &token_id);
        if state.key != &state_key {
            msg!("state PDA mismatch");
            return Err(ProgramError::InvalidSeeds);
        }
        let state_seeds: &[&[u8]] = &[STATE_SEED, &token_id, &[state_bump]];
        let space: u64 = 256;
        let lamports = Rent::get()?.minimum_balance(space as usize);
        solana_program::program::invoke_signed(
            &solana_program::system_instruction::create_account(
                payer.key,
                state.key,
                lamports,
                space,
                program_id,
            ),
            &[payer.clone(), state.clone(), system.clone()],
            &[state_seeds],
        )?;
    }

    msg!(
        "CreatePdaAsset ok frozen={} delegate={} program_freeze={}",
        frozen,
        with_transfer_delegate,
        freeze_auth_is_program
    );
    Ok(())
}

fn thaw_and_burn(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let asset = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let owner = next_account_info(iter)?;
    let freeze_authority = next_account_info(iter)?;
    let core_program = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    let (expected, _bump) = asset_pda(program_id, &token_id);
    if asset.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    let (freeze_key, freeze_bump) = freeze_pda(program_id);
    if freeze_authority.key != &freeze_key {
        return Err(ProgramError::InvalidSeeds);
    }
    if !payer.is_signer || !owner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if core_program.key != &mpl_core::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    let freeze_seeds: &[&[u8]] = &[FREEZE_SEED, &[freeze_bump]];

    UpdatePluginV1CpiBuilder::new(core_program)
        .asset(asset)
        .payer(payer)
        .authority(Some(freeze_authority))
        .system_program(system)
        .plugin(Plugin::PermanentFreezeDelegate(PermanentFreezeDelegate {
            frozen: false,
        }))
        .invoke_signed(&[freeze_seeds])?;

    BurnV1CpiBuilder::new(core_program)
        .asset(asset)
        .payer(payer)
        .authority(Some(owner))
        .system_program(Some(system))
        .invoke()?;

    msg!("ThawAndBurn ok");
    Ok(())
}
