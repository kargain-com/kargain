//! BPF entrypoint — config + gateway-only bridge paths with Metaplex Core CPI.

use borsh::BorshDeserialize;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::Sysvar,
};

use crate::account::into_program_error;
use crate::bridge::{
    check_bridge_burn, check_bridge_mint, check_bridge_reset_on_unlock, check_set_bridge_gateway,
    check_set_custody_lock, is_bridge_gateway_signer,
};
use crate::core_asset::{
    create_asset_with_freeze, is_live_core_asset, read_owner, read_uri, set_frozen, thaw_and_burn,
    update_uri,
};
use crate::instruction::PassportIx;
use crate::seeds::{asset_pda, config_pda, state_pda, CONFIG_SEED, STATE_SEED};
use crate::state::{
    PassportConfig, PassportState, Status, PASSPORT_CONFIG_DISCRIMINATOR,
};
use crate::uri::{check_mint_uri, check_set_uri};

/// Fixed state PDA space (never closed; tombstone after foreign burn).
pub const PASSPORT_STATE_SPACE: usize = 256;

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let ix = PassportIx::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
    match ix {
        PassportIx::Initialize {
            namespace,
            local_eid,
            endpoint_program,
            dispute_deposit,
            staking_program,
            forfeit_recipient,
        } => initialize(
            program_id,
            accounts,
            namespace,
            local_eid,
            endpoint_program,
            dispute_deposit,
            staking_program,
            forfeit_recipient,
        ),
        PassportIx::SetBridgeGateway { gateway } => set_bridge_gateway(program_id, accounts, gateway),
        PassportIx::MintPassport { uri } => mint_passport(program_id, accounts, uri),
        PassportIx::SetPassportUri { token_id, uri } => {
            set_passport_uri(program_id, accounts, token_id, uri)
        }
        PassportIx::May { token_id, intent } => {
            msg!(
                "kar-passport May token={:02x}{:02x} intent={} (host may module)",
                token_id[0],
                token_id[1],
                intent
            );
            Ok(())
        }
        PassportIx::AppendRecord { .. } => {
            msg!("kar-passport AppendRecord stub (S5+ records surface)");
            Ok(())
        }
        PassportIx::SetCustodyLock { token_id, locked } => {
            set_custody_lock(program_id, accounts, token_id, locked)
        }
        PassportIx::BridgeMint {
            to,
            token_id,
            uri,
        } => bridge_mint(program_id, accounts, to, token_id, uri),
        PassportIx::BridgeBurn { token_id } => bridge_burn(program_id, accounts, token_id),
        PassportIx::BridgeResetOnUnlock { token_id, uri } => {
            bridge_reset_on_unlock(program_id, accounts, token_id, uri)
        }
    }
}

fn initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    namespace: u128,
    local_eid: u32,
    endpoint_program: [u8; 32],
    dispute_deposit: u64,
    staking_program: [u8; 32],
    forfeit_recipient: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let authority = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (expected, bump) = config_pda(program_id);
    if config.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    let next = crate::state::token_id_from_parts(namespace, 1);
    let record = PassportConfig {
        discriminator: PASSPORT_CONFIG_DISCRIMINATOR,
        authority: authority.key.to_bytes(),
        namespace,
        local_eid,
        endpoint_program,
        dispute_deposit,
        staking_program,
        bridge_gateway: [0u8; 32],
        forfeit_recipient,
        next_token_id: next,
        encumbrance_sources: vec![],
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
    msg!("kar-passport Initialize ok");
    Ok(())
}

fn load_config(program_id: &Pubkey, config: &AccountInfo) -> Result<PassportConfig, ProgramError> {
    let (expected, _) = config_pda(program_id);
    if config.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if config.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    PassportConfig::try_from_slice(&config.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)
}

fn save_config(config_ai: &AccountInfo, cfg: &PassportConfig) -> ProgramResult {
    let encoded = borsh::to_vec(cfg).map_err(|_| ProgramError::InvalidAccountData)?;
    let mut data = config_ai.try_borrow_mut_data()?;
    if data.len() < encoded.len() {
        return Err(ProgramError::AccountDataTooSmall);
    }
    data[..encoded.len()].copy_from_slice(&encoded);
    Ok(())
}

fn load_state(
    program_id: &Pubkey,
    state: &AccountInfo,
    token_id: &[u8; 32],
) -> Result<PassportState, ProgramError> {
    let (expected, _) = state_pda(program_id, token_id);
    if state.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if state.owner != program_id || state.data_is_empty() {
        return Err(ProgramError::UninitializedAccount);
    }
    // State PDA is fixed PASSPORT_STATE_SPACE; borsh payload is shorter — do not use
    // try_from_slice (exact-length), which rejects trailing padding.
    let data = state.try_borrow_data()?;
    let mut cursor: &[u8] = &data;
    PassportState::deserialize(&mut cursor).map_err(|_| ProgramError::InvalidAccountData)
}

fn save_state(state_ai: &AccountInfo, st: &PassportState) -> ProgramResult {
    let encoded = borsh::to_vec(st).map_err(|_| ProgramError::InvalidAccountData)?;
    let mut data = state_ai.try_borrow_mut_data()?;
    if data.len() < encoded.len() {
        return Err(ProgramError::AccountDataTooSmall);
    }
    for b in data.iter_mut() {
        *b = 0;
    }
    data[..encoded.len()].copy_from_slice(&encoded);
    Ok(())
}

fn require_gateway(cfg: &PassportConfig, gateway: &AccountInfo) -> ProgramResult {
    if !gateway.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !is_bridge_gateway_signer(&cfg.bridge_gateway, &gateway.key.to_bytes()) {
        return Err(into_program_error(
            kargain_errors::KargainError::NotBridgeGateway,
        ));
    }
    Ok(())
}

fn set_bridge_gateway(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    gateway: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let authority = next_account_info(iter)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut cfg = load_config(program_id, config)?;
    if authority.key.to_bytes() != cfg.authority {
        return Err(ProgramError::IllegalOwner);
    }
    check_set_bridge_gateway(cfg.bridge_gateway != [0u8; 32], gateway == [0u8; 32])
        .map_err(into_program_error)?;
    cfg.bridge_gateway = gateway;
    save_config(config, &cfg)?;
    msg!("kar-passport SetBridgeGateway ok");
    Ok(())
}

fn create_state_account<'info>(
    program_id: &Pubkey,
    state: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    token_id: &[u8; 32],
    state_bump: u8,
) -> ProgramResult {
    let (expected, _) = state_pda(program_id, token_id);
    if state.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if system.key != &system_program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if state.lamports() != 0 {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    let lamports = Rent::get()?.minimum_balance(PASSPORT_STATE_SPACE);
    solana_program::program::invoke_signed(
        &system_instruction::create_account(
            payer.key,
            state.key,
            lamports,
            PASSPORT_STATE_SPACE as u64,
            program_id,
        ),
        &[payer.clone(), state.clone(), system.clone()],
        &[&[STATE_SEED, token_id, &[state_bump]]],
    )?;
    Ok(())
}

fn mint_passport(program_id: &Pubkey, accounts: &[AccountInfo], uri: String) -> ProgramResult {
    check_mint_uri(&uri).map_err(into_program_error)?;
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let authority = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let state = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let owner = next_account_info(iter)?;
    let freeze_authority = next_account_info(iter)?;
    let core = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !authority.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut cfg = load_config(program_id, config)?;
    if authority.key.to_bytes() != cfg.authority {
        return Err(ProgramError::IllegalOwner);
    }
    let token_id = cfg.next_token_id;
    let (asset_key, asset_bump) = asset_pda(program_id, &token_id);
    if asset.key != &asset_key {
        return Err(ProgramError::InvalidSeeds);
    }
    if is_live_core_asset(asset) {
        return Err(into_program_error(kargain_errors::KargainError::TokenExists));
    }
    let (_state_key, state_bump) = state_pda(program_id, &token_id);

    create_asset_with_freeze(
        program_id,
        asset,
        payer,
        owner,
        config,
        freeze_authority.key,
        core,
        system,
        &token_id,
        uri,
        false,
        asset_bump,
        cfg.bump,
    )?;
    create_state_account(program_id, state, payer, system, &token_id, state_bump)?;
    let st = PassportState::new_unverified(token_id, state_bump);
    save_state(state, &st)?;

    let seq = u128::from_be_bytes({
        let mut b = [0u8; 16];
        b.copy_from_slice(&token_id[16..32]);
        b
    });
    cfg.next_token_id = crate::state::token_id_from_parts(cfg.namespace, seq.saturating_add(1));
    save_config(config, &cfg)?;
    msg!("kar-passport MintPassport ok");
    Ok(())
}

fn set_passport_uri(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    uri: String,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let state = next_account_info(iter)?;
    let owner = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let core = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !owner.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    let mut st = load_state(program_id, state, &token_id)?;
    if !is_live_core_asset(asset) {
        return Err(into_program_error(
            kargain_errors::KargainError::NonexistentToken,
        ));
    }
    let current = read_uri(asset)?;
    let asset_owner = read_owner(asset)?;
    check_set_uri(
        st.custody_locked,
        asset_owner == *owner.key,
        &uri,
        &current,
        st.status,
    )
    .map_err(into_program_error)?;

    let seeds: &[&[u8]] = &[CONFIG_SEED, &[cfg.bump]];
    update_uri(asset, payer, config, core, system, uri, seeds)?;
    if st.status == Status::Verified {
        st.status = Status::Unverified;
        st.verifier = [0u8; 32];
        st.verified_at = 0;
        save_state(state, &st)?;
    }
    msg!("kar-passport SetPassportUri ok");
    Ok(())
}

/// Accounts: config, gateway(signer), asset, state, payer, freeze(signer), core, system
fn set_custody_lock(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    locked: bool,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let gateway = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let state = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let freeze = next_account_info(iter)?;
    let core = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    require_gateway(&cfg, gateway)?;
    let live = is_live_core_asset(asset);
    check_set_custody_lock(true, &token_id, cfg.namespace, live).map_err(into_program_error)?;
    let mut st = load_state(program_id, state, &token_id)?;

    set_frozen(asset, payer, freeze, core, system, locked)?;
    st.custody_locked = locked;
    save_state(state, &st)?;
    msg!("kar-passport SetCustodyLock locked={}", locked);
    Ok(())
}

/// Accounts: config, gateway(signer), asset, state, payer, to, freeze_authority, core, system
fn bridge_mint(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    to: [u8; 32],
    token_id: [u8; 32],
    uri: String,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let gateway = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let state = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let owner = next_account_info(iter)?;
    let freeze_authority = next_account_info(iter)?;
    let core = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if owner.key.to_bytes() != to {
        return Err(ProgramError::InvalidArgument);
    }
    let cfg = load_config(program_id, config)?;
    require_gateway(&cfg, gateway)?;
    let exists = is_live_core_asset(asset);
    check_bridge_mint(true, &token_id, cfg.namespace, exists, &uri).map_err(into_program_error)?;

    let (asset_key, asset_bump) = asset_pda(program_id, &token_id);
    if asset.key != &asset_key {
        return Err(ProgramError::InvalidSeeds);
    }
    let (_state_key, state_bump) = state_pda(program_id, &token_id);

    create_asset_with_freeze(
        program_id,
        asset,
        payer,
        owner,
        config,
        freeze_authority.key,
        core,
        system,
        &token_id,
        uri.clone(),
        false,
        asset_bump,
        cfg.bump,
    )?;

    // State PDA: create if absent; refuse remint if live asset already existed (checked above).
    // After foreign burn, state may remain as tombstone — reuse it (D-17).
    if state.lamports() == 0 {
        create_state_account(program_id, state, payer, system, &token_id, state_bump)?;
        let st = PassportState::new_unverified(token_id, state_bump);
        save_state(state, &st)?;
    } else {
        let mut st = load_state(program_id, state, &token_id)?;
        st.status = Status::Unverified;
        st.verifier = [0u8; 32];
        st.verified_at = 0;
        st.custody_locked = false;
        st.burned = false;
        save_state(state, &st)?;
    }
    msg!("kar-passport BridgeMint ok");
    Ok(())
}

/// Accounts: config, gateway(signer), asset, state, payer, owner(signer), freeze(signer), core, system
fn bridge_burn(program_id: &Pubkey, accounts: &[AccountInfo], token_id: [u8; 32]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let gateway = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let state = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let owner = next_account_info(iter)?;
    let freeze = next_account_info(iter)?;
    let core = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !payer.is_signer || !owner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    require_gateway(&cfg, gateway)?;
    let live = is_live_core_asset(asset);
    check_bridge_burn(true, &token_id, cfg.namespace, live).map_err(into_program_error)?;
    let asset_owner = read_owner(asset)?;
    if asset_owner != *owner.key {
        return Err(into_program_error(
            kargain_errors::KargainError::NotRepresentationOwner,
        ));
    }

    thaw_and_burn(asset, payer, owner, freeze, core, system)?;

    let mut st = load_state(program_id, state, &token_id)?;
    st.burned = true;
    st.custody_locked = false;
    st.status = Status::Unverified;
    st.verifier = [0u8; 32];
    st.verified_at = 0;
    save_state(state, &st)?;
    msg!("kar-passport BridgeBurn ok");
    Ok(())
}

/// Accounts: config, gateway(signer), asset, state, payer, freeze(signer), core, system
fn bridge_reset_on_unlock(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    uri: String,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let gateway = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let state = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let freeze = next_account_info(iter)?;
    let core = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    require_gateway(&cfg, gateway)?;
    let live = is_live_core_asset(asset);
    let mut st = load_state(program_id, state, &token_id)?;
    let plan = check_bridge_reset_on_unlock(
        true,
        &token_id,
        cfg.namespace,
        live,
        st.status,
        &uri,
    )
    .map_err(into_program_error)?;

    // Thaw if frozen (home may have been frozen while abroad).
    set_frozen(asset, payer, freeze, core, system, false)?;

    if plan.adopt_uri {
        let seeds: &[&[u8]] = &[CONFIG_SEED, &[cfg.bump]];
        update_uri(asset, payer, config, core, system, uri, seeds)?;
    }

    st.status = Status::Unverified;
    st.verifier = [0u8; 32];
    st.verified_at = 0;
    st.custody_locked = false;
    save_state(state, &st)?;
    if plan.emit_verification_reset {
        msg!("kar-passport VerificationReset");
    }
    msg!("kar-passport BridgeResetOnUnlock ok");
    Ok(())
}
