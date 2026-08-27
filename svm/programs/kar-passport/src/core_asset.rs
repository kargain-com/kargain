//! Metaplex Core helpers — live-asset predicate + CPI builders (lab pattern).

use mpl_core::{
    accounts::BaseAssetV1,
    instructions::{
        BurnV1CpiBuilder, CreateV1CpiBuilder, TransferV1CpiBuilder, UpdatePluginV1CpiBuilder,
        UpdateV1CpiBuilder,
    },
    types::{
        DataState, PermanentFreezeDelegate, Plugin, PluginAuthority, PluginAuthorityPair,
    },
};
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, program_error::ProgramError,
    pubkey::Pubkey, system_program,
};

use crate::seeds::ASSET_SEED;

/// Live Core asset (D-17): owned by Core with more than the 1-byte burn tombstone.
pub fn is_live_core_asset(asset: &AccountInfo) -> bool {
    asset.owner == &mpl_core::ID && asset.data_len() > 1
}

pub fn read_uri(asset: &AccountInfo) -> Result<String, ProgramError> {
    if !is_live_core_asset(asset) {
        return Err(ProgramError::UninitializedAccount);
    }
    let data = asset.try_borrow_data()?;
    let base = BaseAssetV1::from_bytes(&data).map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(base.uri)
}

pub fn read_owner(asset: &AccountInfo) -> Result<Pubkey, ProgramError> {
    if !is_live_core_asset(asset) {
        return Err(ProgramError::UninitializedAccount);
    }
    let data = asset.try_borrow_data()?;
    let base = BaseAssetV1::from_bytes(&data).map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(base.owner)
}

/// Create Core asset at passport asset PDA + PermanentFreeze (authority = gateway freeze PDA).
///
/// Core `CreateV1` requires the update-authority account to sign when set — that is the
/// passport config PDA, so we `invoke_signed` with both asset and config seeds.
pub fn create_asset_with_freeze<'info>(
    program_id: &Pubkey,
    asset: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    update_authority: &AccountInfo<'info>,
    freeze_authority_key: &Pubkey,
    core_program: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    token_id: &[u8; 32],
    uri: String,
    frozen: bool,
    asset_bump: u8,
    config_bump: u8,
) -> ProgramResult {
    if core_program.key != &mpl_core::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if system.key != &system_program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (expected, _) = crate::seeds::asset_pda(program_id, token_id);
    if asset.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }

    let plugins = vec![PluginAuthorityPair {
        plugin: Plugin::PermanentFreezeDelegate(PermanentFreezeDelegate { frozen }),
        authority: Some(PluginAuthority::Address {
            address: *freeze_authority_key,
        }),
    }];

    let asset_seeds: &[&[u8]] = &[ASSET_SEED, token_id, &[asset_bump]];
    let config_seeds: &[&[u8]] = &[crate::seeds::CONFIG_SEED, &[config_bump]];
    CreateV1CpiBuilder::new(core_program)
        .asset(asset)
        .payer(payer)
        .owner(Some(owner))
        .update_authority(Some(update_authority))
        .system_program(system)
        .data_state(DataState::AccountState)
        .name("KarPassport".to_string())
        .uri(uri)
        .plugins(plugins)
        .invoke_signed(&[asset_seeds, config_seeds])?;
    Ok(())
}

pub fn set_frozen<'info>(
    asset: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    freeze_authority: &AccountInfo<'info>,
    core_program: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    frozen: bool,
) -> ProgramResult {
    if core_program.key != &mpl_core::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    // Freeze PDA must already be a signer (gateway elevated it via invoke_signed).
    if !freeze_authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    UpdatePluginV1CpiBuilder::new(core_program)
        .asset(asset)
        .payer(payer)
        .authority(Some(freeze_authority))
        .system_program(system)
        .plugin(Plugin::PermanentFreezeDelegate(PermanentFreezeDelegate {
            frozen,
        }))
        .invoke()?;
    Ok(())
}

/// Thaw (freeze PDA) then burn (owner) — same instruction pattern as lab RESULTS.
pub fn thaw_and_burn<'info>(
    asset: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    freeze_authority: &AccountInfo<'info>,
    core_program: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
) -> ProgramResult {
    set_frozen(asset, payer, freeze_authority, core_program, system, false)?;
    BurnV1CpiBuilder::new(core_program)
        .asset(asset)
        .payer(payer)
        .authority(Some(owner))
        .system_program(Some(system))
        .invoke()?;
    Ok(())
}

pub fn update_uri<'info>(
    asset: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    update_authority: &AccountInfo<'info>,
    core_program: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    new_uri: String,
    authority_seeds: &[&[u8]],
) -> ProgramResult {
    if core_program.key != &mpl_core::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    UpdateV1CpiBuilder::new(core_program)
        .asset(asset)
        .payer(payer)
        .authority(Some(update_authority))
        .system_program(system)
        .new_uri(new_uri)
        .invoke_signed(&[authority_seeds])?;
    Ok(())
}

pub fn transfer_asset<'info>(
    asset: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    new_owner: &AccountInfo<'info>,
    core_program: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    authority_seeds: Option<&[&[u8]]>,
) -> ProgramResult {
    if core_program.key != &mpl_core::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    let mut builder = TransferV1CpiBuilder::new(core_program);
    builder
        .asset(asset)
        .payer(payer)
        .authority(Some(authority))
        .new_owner(new_owner)
        .system_program(Some(system));
    if let Some(seeds) = authority_seeds {
        builder.invoke_signed(&[seeds])?;
    } else {
        builder.invoke()?;
    }
    Ok(())
}
