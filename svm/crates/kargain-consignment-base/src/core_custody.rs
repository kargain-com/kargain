//! Sole Core custody helpers for mode programs (S8-E step 4).
//!
//! Binding, freeze gate, TransferDelegate read, and TransferV1 moves.
//! Passport Core asset address + liveness: `kargain-passport-asset`.
//! `kar-passport/src/core_asset.rs` stays the passport's own CPI door.
//!
//! mpl-core facts (pinned by stand tests):
//! - (a) TransferV1 resets owner-managed TransferDelegate authority to Owner.
//! - (b) Frozen PermanentFreezeDelegate → Core `InvalidAuthority` (9); we refuse
//!   with `AssetFrozen` before CPI so the refusal is named.
//!
//! No public function in this module may TransferV1 without `require_not_frozen`.
//! Fact-(b) skip-freeze plant lives only in consignment-harness.

use kargain_errors::KargainError;
use kargain_passport_asset::asset_pda;
use mpl_core::{
    instructions::TransferV1CpiBuilder,
    Asset, AuthorityType,
};
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::{custody_authority_pda, CUSTODY_SEED};

/// Re-export passport asset seed for callers that need invoke_signed seed bytes.
pub use kargain_passport_asset::ASSET_SEED as PASSPORT_ASSET_SEED;

/// Re-export live-Core predicate from the sole owner.
pub use kargain_passport_asset::is_live_core_asset;

fn into_pe(e: KargainError) -> ProgramError {
    ProgramError::Custom(u32::from(e))
}

/// Derive the passport Core asset PDA for `token_id` under `passport_program`.
#[inline]
pub fn passport_asset_pda(passport_program: &Pubkey, token_id: &[u8; 32]) -> (Pubkey, u8) {
    asset_pda(passport_program, token_id)
}

/// Binding: account key == passport asset PDA and account is a live Core asset.
pub fn require_passport_core_asset(
    passport_program: &Pubkey,
    token_id: &[u8; 32],
    asset: &AccountInfo,
) -> Result<(), ProgramError> {
    let (expected, _) = passport_asset_pda(passport_program, token_id);
    if asset.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if !is_live_core_asset(asset) {
        return Err(into_pe(KargainError::NotLiveCoreAsset));
    }
    Ok(())
}

/// Read the Core asset owner pubkey from account data.
pub fn core_asset_owner(asset: &AccountInfo) -> Result<Pubkey, ProgramError> {
    let data = asset.try_borrow_data()?;
    let parsed = Asset::from_bytes(&data).map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(parsed.base.owner)
}

/// Pure freeze read from account data (host-testable).
pub fn is_permanently_frozen(data: &[u8]) -> Result<bool, ProgramError> {
    let asset = Asset::from_bytes(data).map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(asset
        .plugin_list
        .permanent_freeze_delegate
        .as_ref()
        .map(|p| p.permanent_freeze_delegate.frozen)
        .unwrap_or(false))
}

/// Refuse when PermanentFreezeDelegate is frozen — named gate before TransferV1.
pub fn require_not_frozen(asset: &AccountInfo) -> Result<(), ProgramError> {
    let data = asset.try_borrow_data()?;
    if is_permanently_frozen(&data)? {
        return Err(into_pe(KargainError::AssetFrozen));
    }
    Ok(())
}

/// Whether a TransferDelegate plugin exists with authority equal to `expected`.
pub fn has_transfer_delegate(data: &[u8], expected: &Pubkey) -> Result<bool, ProgramError> {
    let asset = Asset::from_bytes(data).map_err(|_| ProgramError::InvalidAccountData)?;
    let Some(td) = asset.plugin_list.transfer_delegate.as_ref() else {
        return Ok(false);
    };
    Ok(match td.base.authority.authority_type {
        AuthorityType::Address => td.base.authority.address.as_ref() == Some(expected),
        AuthorityType::Owner => false,
        AuthorityType::UpdateAuthority | AuthorityType::None => false,
    })
}

/// Require TransferDelegate with authority == `expected`.
pub fn require_transfer_delegate(
    asset: &AccountInfo,
    expected: &Pubkey,
) -> Result<(), ProgramError> {
    let data = asset.try_borrow_data()?;
    if !has_transfer_delegate(&data, expected)? {
        return Err(into_pe(KargainError::NotTransferDelegate));
    }
    Ok(())
}

fn transfer_v1<'info>(
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

/// Owner signer → custody PDA. Binding + freeze gate first.
pub fn transfer_owner_to_custody<'info>(
    mode_program: &Pubkey,
    passport_program: &Pubkey,
    token_id: &[u8; 32],
    asset: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    custody: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    core_program: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
) -> ProgramResult {
    require_passport_core_asset(passport_program, token_id, asset)?;
    require_not_frozen(asset)?;
    if !owner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (expected_custody, _) = custody_authority_pda(mode_program);
    if custody.key != &expected_custody {
        return Err(ProgramError::InvalidSeeds);
    }
    transfer_v1(asset, payer, owner, custody, core_program, system, None)
}

/// Custody PDA as TransferDelegate → custody as owner.
pub fn transfer_delegate_to_custody<'info>(
    mode_program: &Pubkey,
    passport_program: &Pubkey,
    token_id: &[u8; 32],
    asset: &AccountInfo<'info>,
    custody: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    core_program: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
) -> ProgramResult {
    require_passport_core_asset(passport_program, token_id, asset)?;
    require_not_frozen(asset)?;
    let (expected_custody, bump) = custody_authority_pda(mode_program);
    if custody.key != &expected_custody {
        return Err(ProgramError::InvalidSeeds);
    }
    require_transfer_delegate(asset, &expected_custody)?;
    let seeds: &[&[u8]] = &[CUSTODY_SEED, &[bump]];
    transfer_v1(
        asset,
        payer,
        custody,
        custody,
        core_program,
        system,
        Some(seeds),
    )
}

/// Custody PDA signs → recipient. After success Core resets TransferDelegate to Owner (fact a).
pub fn transfer_custody_to_recipient<'info>(
    mode_program: &Pubkey,
    passport_program: &Pubkey,
    token_id: &[u8; 32],
    asset: &AccountInfo<'info>,
    custody: &AccountInfo<'info>,
    recipient: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    core_program: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
) -> ProgramResult {
    require_passport_core_asset(passport_program, token_id, asset)?;
    require_not_frozen(asset)?;
    let (expected_custody, bump) = custody_authority_pda(mode_program);
    if custody.key != &expected_custody {
        return Err(ProgramError::InvalidSeeds);
    }
    let seeds: &[&[u8]] = &[CUSTODY_SEED, &[bump]];
    transfer_v1(
        asset,
        payer,
        custody,
        recipient,
        core_program,
        system,
        Some(seeds),
    )
}

/// Current Core owner signs TransferV1 → named recipient (Ascending CompleteReversal).
/// Freeze-gated like the other movers. Caller proves `core_asset_owner == expected`
/// (e.g. hold.buyer) before calling — this helper only requires owner is signer.
pub fn transfer_owner_to_recipient<'info>(
    passport_program: &Pubkey,
    token_id: &[u8; 32],
    asset: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    recipient: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    core_program: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
) -> ProgramResult {
    require_passport_core_asset(passport_program, token_id, asset)?;
    require_not_frozen(asset)?;
    if !owner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let current = core_asset_owner(asset)?;
    if current != *owner.key {
        return Err(into_pe(KargainError::NotPassportHolder));
    }
    transfer_v1(asset, payer, owner, recipient, core_program, system, None)
}

/// Read TransferDelegate authority type after a move (stand fact-a pin).
pub fn transfer_delegate_authority_is_owner(data: &[u8]) -> Result<bool, ProgramError> {
    let asset = Asset::from_bytes(data).map_err(|_| ProgramError::InvalidAccountData)?;
    let Some(td) = asset.plugin_list.transfer_delegate.as_ref() else {
        return Ok(true); // no plugin ≡ no standing delegate
    };
    Ok(td.base.authority.authority_type == AuthorityType::Owner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mpl_core::types::{Key, PluginAuthority, PluginType};
    use solana_program::pubkey::Pubkey;

    fn pk(b: u8) -> Pubkey {
        Pubkey::new_from_array([b; 32])
    }

    /// Host-built Core asset account bytes (mpl-core 0.11 wire layout).
    fn asset_bytes_plugins(
        owner: Pubkey,
        frozen: bool,
        transfer_authority: Option<Pubkey>,
    ) -> Vec<u8> {
        // BaseAssetV1: Key::AssetV1(1) + owner + UpdateAuthority::None(0) + empty name/uri + seq None(0)
        let mut base = Vec::new();
        base.push(Key::AssetV1 as u8);
        base.extend_from_slice(owner.as_ref());
        base.push(0u8); // UpdateAuthority::None
        base.extend_from_slice(&0u32.to_le_bytes()); // name len
        base.extend_from_slice(&0u32.to_le_bytes()); // uri len
        base.push(0u8); // seq: None

        let mut plugin_blobs: Vec<Vec<u8>> = Vec::new();
        let mut records: Vec<(u8, PluginAuthority, u64)> = Vec::new();

        // PermanentFreezeDelegate disc=5 + frozen bool
        let freeze_bytes = vec![5u8, u8::from(frozen)];
        let freeze_offset = (base.len() + 9) as u64; // PluginHeaderV1::LEN
        records.push((
            PluginType::PermanentFreezeDelegate as u8,
            PluginAuthority::UpdateAuthority,
            freeze_offset,
        ));
        plugin_blobs.push(freeze_bytes);

        if let Some(addr) = transfer_authority {
            // TransferDelegate disc=3, empty payload
            let transfer_bytes = vec![3u8];
            let transfer_offset = freeze_offset + plugin_blobs[0].len() as u64;
            records.push((
                PluginType::TransferDelegate as u8,
                PluginAuthority::Address { address: addr },
                transfer_offset,
            ));
            plugin_blobs.push(transfer_bytes);
        }

        let registry_offset =
            freeze_offset + plugin_blobs.iter().map(|b| b.len() as u64).sum::<u64>();

        // PluginHeaderV1: Key::PluginHeaderV1(3) + u64 offset
        let mut header = vec![3u8];
        header.extend_from_slice(&registry_offset.to_le_bytes());

        // PluginRegistryV1: Key(4) + Vec<RegistryRecord> + empty external
        let mut registry = vec![4u8];
        registry.extend_from_slice(&(records.len() as u32).to_le_bytes());
        for (plugin_type, authority, offset) in &records {
            registry.push(*plugin_type);
            match authority {
                PluginAuthority::None => registry.push(0),
                PluginAuthority::Owner => registry.push(1),
                PluginAuthority::UpdateAuthority => registry.push(2),
                PluginAuthority::Address { address } => {
                    registry.push(3);
                    registry.extend_from_slice(address.as_ref());
                }
            }
            registry.extend_from_slice(&offset.to_le_bytes());
        }
        registry.extend_from_slice(&0u32.to_le_bytes()); // external_registry empty

        let mut out = base;
        out.extend(header);
        for blob in plugin_blobs {
            out.extend(blob);
        }
        out.extend(registry);
        out
    }

    #[test]
    fn passport_asset_pda_uses_asset_seed_not_harness() {
        let program = pk(7);
        let token = [3u8; 32];
        let (a, _) = passport_asset_pda(&program, &token);
        let (b, _) = Pubkey::find_program_address(&[PASSPORT_ASSET_SEED, &token], &program);
        assert_eq!(a, b);
        assert_eq!(PASSPORT_ASSET_SEED, b"asset");
        assert_ne!(PASSPORT_ASSET_SEED, b"harness-asset");
    }

    #[test]
    fn binding_wrong_token_pda_refused() {
        let passport = pk(9);
        let token = [1u8; 32];
        let wrong_token = [2u8; 32];
        let (wrong_key, _) = passport_asset_pda(&passport, &wrong_token);

        let mut lamports = 0u64;
        let mut data = vec![0u8; 2];
        let core_id = mpl_core::ID;
        let asset = AccountInfo::new(
            &wrong_key,
            false,
            false,
            &mut lamports,
            &mut data,
            &core_id,
            false,
            0,
        );
        let err = require_passport_core_asset(&passport, &token, &asset).unwrap_err();
        assert_eq!(err, ProgramError::InvalidSeeds);
    }

    #[test]
    fn binding_non_core_owner_refused() {
        let passport = pk(9);
        let token = [1u8; 32];
        let (key, _) = passport_asset_pda(&passport, &token);
        let mut lamports = 0u64;
        let mut data = vec![0u8; 64];
        let foreign = pk(3);
        let asset = AccountInfo::new(
            &key,
            false,
            false,
            &mut lamports,
            &mut data,
            &foreign,
            false,
            0,
        );
        let err = require_passport_core_asset(&passport, &token, &asset).unwrap_err();
        assert_eq!(
            err,
            ProgramError::Custom(u32::from(KargainError::NotLiveCoreAsset))
        );
    }

    #[test]
    fn freeze_read_frozen_vs_not() {
        let owner = pk(1);
        let frozen = asset_bytes_plugins(owner, true, None);
        let thawed = asset_bytes_plugins(owner, false, None);
        assert_eq!(is_permanently_frozen(&frozen).unwrap(), true);
        assert_eq!(is_permanently_frozen(&thawed).unwrap(), false);
    }

    #[test]
    fn require_not_frozen_refuses_named() {
        let owner = pk(1);
        let mut data = asset_bytes_plugins(owner, true, None);
        let mut lamports = 0u64;
        let key = pk(9);
        let core_id = mpl_core::ID;
        let asset = AccountInfo::new(
            &key,
            false,
            false,
            &mut lamports,
            &mut data,
            &core_id,
            false,
            0,
        );
        let err = require_not_frozen(&asset).unwrap_err();
        assert_eq!(
            err,
            ProgramError::Custom(u32::from(KargainError::AssetFrozen))
        );
    }

    #[test]
    fn transfer_delegate_match_vs_foreign() {
        let owner = pk(1);
        let custody = pk(5);
        let foreign = pk(6);
        let with = asset_bytes_plugins(owner, false, Some(custody));
        assert_eq!(has_transfer_delegate(&with, &custody).unwrap(), true);
        assert_eq!(has_transfer_delegate(&with, &foreign).unwrap(), false);
        let none = asset_bytes_plugins(owner, false, None);
        assert_eq!(has_transfer_delegate(&none, &custody).unwrap(), false);
    }

    #[test]
    fn plant_messages_named() {
        assert_eq!(KargainError::AssetFrozen.name(), "AssetFrozen");
        assert_eq!(
            KargainError::NotTransferDelegate.name(),
            "NotTransferDelegate"
        );
        assert_eq!(KargainError::NotLiveCoreAsset.name(), "NotLiveCoreAsset");
    }
}
