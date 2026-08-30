//! Metaplex Core create / thaw+burn for soulbound pass.

use mpl_core::{
    accounts::BaseAssetV1,
    instructions::{BurnV1CpiBuilder, CreateV1CpiBuilder, UpdatePluginV1CpiBuilder},
    types::{
        DataState, PermanentFreezeDelegate, Plugin, PluginAuthority, PluginAuthorityPair,
    },
};
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, program_error::ProgramError,
    pubkey::Pubkey, system_program,
};

use crate::seeds::{PASS_SEED, CONFIG_SEED, FREEZE_SEED};

pub fn is_live_core_asset(asset: &AccountInfo) -> bool {
    asset.owner == &mpl_core::ID && asset.data_len() > 1
}

pub fn read_owner(asset: &AccountInfo) -> Result<Pubkey, ProgramError> {
    if !is_live_core_asset(asset) {
        return Err(ProgramError::UninitializedAccount);
    }
    let data = asset.try_borrow_data()?;
    let base = BaseAssetV1::from_bytes(&data).map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(base.owner)
}

pub fn create_pass_asset<'info>(
    program_id: &Pubkey,
    asset: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    update_authority: &AccountInfo<'info>,
    freeze_authority_key: &Pubkey,
    core_program: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    holder: &[u8; 32],
    name: String,
    uri: String,
    asset_bump: u8,
    config_bump: u8,
) -> ProgramResult {
    if core_program.key != &mpl_core::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if system.key != &system_program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (expected, _) = crate::seeds::pass_asset_pda(program_id, holder);
    if asset.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }

    let plugins = vec![PluginAuthorityPair {
        plugin: Plugin::PermanentFreezeDelegate(PermanentFreezeDelegate { frozen: true }),
        authority: Some(PluginAuthority::Address {
            address: *freeze_authority_key,
        }),
    }];

    let asset_seeds: &[&[u8]] = &[PASS_SEED, holder, &[asset_bump]];
    let config_seeds: &[&[u8]] = &[CONFIG_SEED, &[config_bump]];
    CreateV1CpiBuilder::new(core_program)
        .asset(asset)
        .payer(payer)
        .owner(Some(owner))
        .update_authority(Some(update_authority))
        .system_program(system)
        .data_state(DataState::AccountState)
        .name(name)
        .uri(uri)
        .plugins(plugins)
        .invoke_signed(&[asset_seeds, config_seeds])?;
    Ok(())
}

pub fn thaw_and_burn<'info>(
    asset: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    freeze_authority: &AccountInfo<'info>,
    freeze_bump: u8,
    core_program: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
) -> ProgramResult {
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
    Ok(())
}
