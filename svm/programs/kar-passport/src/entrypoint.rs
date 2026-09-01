//! BPF entrypoint — config + gateway-only bridge paths with Metaplex Core CPI.

use borsh::{BorshDeserialize, BorshSerialize};
use kargain_bonded_challenge::{ChallengeAccount, CHALLENGE_SEED};
use kargain_events::generated;
use kargain_events::ops_log;
use kargain_events::passport_terminal::{emit_verification_lapsed, emit_verification_stood};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    program::invoke,
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
use crate::challenge::{
    append_dispute_withdrawn_record, challenge_config_from_passport, challenge_pda_for,
    check_open_challenge, emit_challenge_event, run_conclude_challenge, run_judge_challenge, run_open_challenge,
    run_withdraw_challenge, PassportHooks,
};
use crate::claims::withdraw_claim_ix;
use crate::core_asset::{
    create_asset_with_freeze, is_live_core_asset, read_owner, read_uri, set_frozen, thaw_and_burn,
    transfer_asset, update_uri,
};
use crate::instruction::PassportIx;
use crate::records::{
    check_append_attestation, check_append_record, check_report_discrepancy,
    append_record_checked, gate_and_read_owner, RECORD_TYPE_ATTESTATION, RECORD_TYPE_DISCREPANCY,
};
use crate::seeds::{asset_pda, config_pda, state_pda, CONFIG_SEED, STATE_SEED};
use crate::state::{
    PassportConfig, PassportState, Status, PASSPORT_CONFIG_DISCRIMINATOR,
};
use crate::uri::{check_mint_uri, check_set_uri};
use crate::verify::check_verify_passport;
use kargain_bonded_challenge::JudgeOutcome;

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
            ops_log!(
                "kar-passport May token={:02x}{:02x} intent={} (host may module)",
                token_id[0],
                token_id[1],
                intent
            );
            Ok(())
        }
        PassportIx::AppendRecord {
            token_id,
            record_type,
            description,
            evidence_cid,
        } => append_record(
            program_id,
            accounts,
            token_id,
            record_type,
            description,
            evidence_cid,
        ),
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
        PassportIx::SetStakingProgram { staking_program } => {
            set_staking_program(program_id, accounts, staking_program)
        }
        PassportIx::VerifyPassport { token_id } => verify_passport(program_id, accounts, token_id),
        PassportIx::OpenChallenge { token_id } => open_challenge(program_id, accounts, token_id),
        PassportIx::WithdrawChallenge { token_id } => {
            withdraw_challenge(program_id, accounts, token_id)
        }
        PassportIx::JudgeChallenge {
            token_id,
            outcome,
        } => judge_challenge(program_id, accounts, token_id, outcome),
        PassportIx::ConcludeChallenge { token_id } => {
            conclude_challenge(program_id, accounts, token_id)
        }
        PassportIx::WithdrawClaim => withdraw_claim_ix(program_id, accounts),
        PassportIx::SetDisputeDeposit { dispute_deposit } => {
            set_dispute_deposit(program_id, accounts, dispute_deposit)
        }
        PassportIx::ReportDiscrepancy {
            token_id,
            description,
            evidence_cid,
        } => report_discrepancy(program_id, accounts, token_id, description, evidence_cid),
        PassportIx::AppendAttestation {
            token_id,
            description,
            evidence_cid,
        } => append_attestation(program_id, accounts, token_id, description, evidence_cid),
        PassportIx::TransferPassport { token_id } => {
            transfer_passport(program_id, accounts, token_id)
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
    ops_log!("kar-passport Initialize ok");
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
    ops_log!("kar-passport SetBridgeGateway ok");
    Ok(())
}

fn set_staking_program(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    staking_program: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let authority = next_account_info(iter)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if staking_program == [0u8; 32] {
        return Err(into_program_error(kargain_errors::KargainError::ZeroAddress));
    }
    let mut cfg = load_config(program_id, config)?;
    if authority.key.to_bytes() != cfg.authority {
        return Err(ProgramError::IllegalOwner);
    }
    cfg.staking_program = staking_program;
    save_config(config, &cfg)?;
    ops_log!("kar-passport SetStakingProgram ok");
    Ok(())
}

/// Accounts: config, asset, state, stake, verifier(signer)
fn verify_passport(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let state = next_account_info(iter)?;
    let stake = next_account_info(iter)?;
    let verifier = next_account_info(iter)?;

    if !verifier.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    let mut st = load_state(program_id, state, &token_id)?;
    let live = is_live_core_asset(asset);
    let asset_owner = if live {
        read_owner(asset)?
    } else {
        Pubkey::default()
    };

    let staking_program = Pubkey::new_from_array(cfg.staking_program);
    let owned_by_staking = stake.owner == &staking_program;
    let stake_data = if stake.data_is_empty() {
        None
    } else {
        Some(stake.try_borrow_data()?.to_vec())
    };

    check_verify_passport(
        live,
        st.custody_locked,
        st.burned,
        st.status,
        &asset_owner,
        verifier.key,
        stake_data.as_deref(),
        owned_by_staking,
        Some(stake.key),
        &staking_program,
    )
    .map_err(into_program_error)?;

    let now = Clock::get()?.unix_timestamp as u64;
    st.status = Status::Verified;
    st.verifier = verifier.key.to_bytes();
    st.verified_at = now;
    save_state(state, &st)?;
    generated::emit_kar_passport_passport_verified(token_id, verifier.key.to_bytes());
    ops_log!("kar-passport VerifyPassport ok");
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
    let uri_for_event = uri.clone();

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
    generated::emit_kar_passport_passport_minted(
        owner.key.to_bytes(),
        token_id,
        uri_for_event,
    );
    ops_log!("kar-passport MintPassport ok");
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
    let outcome = check_set_uri(
        st.custody_locked,
        asset_owner == *owner.key,
        &uri,
        &current,
        st.status,
    )
    .map_err(into_program_error)?;
    let reset = matches!(
        outcome,
        crate::uri::UriSetOutcome::Applied {
            reset_verification: true
        }
    );
    let uri_for_event = uri.clone();

    let seeds: &[&[u8]] = &[CONFIG_SEED, &[cfg.bump]];
    update_uri(asset, payer, config, core, system, uri, seeds)?;
    if reset {
        st.status = Status::Unverified;
        st.verifier = [0u8; 32];
        st.verified_at = 0;
        save_state(state, &st)?;
        generated::emit_kar_passport_verification_reset(token_id, owner.key.to_bytes());
    }
    generated::emit_kar_passport_passport_uriupdated(
        token_id,
        uri_for_event,
        owner.key.to_bytes(),
    );
    ops_log!("kar-passport SetPassportUri ok");
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
    generated::emit_kar_passport_custody_lock_set(token_id, u8::from(locked));
    ops_log!("kar-passport SetCustodyLock locked={}", locked);
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
    generated::emit_kar_passport_passport_bridge_minted(to, token_id, uri);
    ops_log!("kar-passport BridgeMint ok");
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
    generated::emit_kar_passport_passport_bridge_burned(token_id);
    ops_log!("kar-passport BridgeBurn ok");
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
        generated::emit_kar_passport_verification_reset(token_id, gateway.key.to_bytes());
    }
    generated::emit_kar_passport_custody_lock_set(token_id, 0);
    ops_log!("kar-passport BridgeResetOnUnlock ok");
    Ok(())
}

// ---- Records ----

/// Accounts: config, asset, state, record, author(signer), payer, system
fn append_record(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    record_type: String,
    description: String,
    evidence_cid: String,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let _config = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let state = next_account_info(iter)?;
    let record = next_account_info(iter)?;
    let author = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !author.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut st = load_state(program_id, state, &token_id)?;
    let (live, owner) = gate_and_read_owner(asset)?;
    check_append_record(
        live,
        st.burned,
        st.custody_locked,
        owner == *author.key,
        &record_type,
        &description,
    )
    .map_err(into_program_error)?;
    let now = Clock::get()?.unix_timestamp as u64;
    append_record_checked(
        program_id,
        asset,
        &mut st,
        record,
        payer,
        system,
        author.key.to_bytes(),
        record_type,
        description,
        evidence_cid,
        now,
    )?;
    save_state(state, &st)?;
    Ok(())
}

/// Accounts: config, asset, state, record, reporter(signer), payer, system
fn report_discrepancy(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    description: String,
    evidence_cid: String,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let _config = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let state = next_account_info(iter)?;
    let record = next_account_info(iter)?;
    let reporter = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !reporter.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut st = load_state(program_id, state, &token_id)?;
    let (live, _) = gate_and_read_owner(asset)?;
    check_report_discrepancy(live, st.burned, st.custody_locked, &description)
        .map_err(into_program_error)?;
    let now = Clock::get()?.unix_timestamp as u64;
    append_record_checked(
        program_id,
        asset,
        &mut st,
        record,
        payer,
        system,
        reporter.key.to_bytes(),
        RECORD_TYPE_DISCREPANCY.to_string(),
        description,
        evidence_cid,
        now,
    )?;
    save_state(state, &st)?;
    Ok(())
}

/// Accounts: config, asset, state, record, attester(signer), stake, payer, system
fn append_attestation(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    description: String,
    evidence_cid: String,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let state = next_account_info(iter)?;
    let record = next_account_info(iter)?;
    let attester = next_account_info(iter)?;
    let stake = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !attester.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    let mut st = load_state(program_id, state, &token_id)?;
    let (live, _) = gate_and_read_owner(asset)?;
    let staking_program = Pubkey::new_from_array(cfg.staking_program);
    let stake_data = if stake.data_is_empty() {
        None
    } else {
        Some(stake.try_borrow_data()?.to_vec())
    };
    check_append_attestation(
        live,
        st.burned,
        st.custody_locked,
        &description,
        stake_data.as_deref(),
        stake.owner == &staking_program,
        Some(stake.key),
        attester.key,
        &staking_program,
    )
    .map_err(into_program_error)?;
    let now = Clock::get()?.unix_timestamp as u64;
    append_record_checked(
        program_id,
        asset,
        &mut st,
        record,
        payer,
        system,
        attester.key.to_bytes(),
        RECORD_TYPE_ATTESTATION.to_string(),
        description,
        evidence_cid,
        now,
    )?;
    save_state(state, &st)?;
    Ok(())
}

// ---- Challenge ----

fn create_pda<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    account: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    space: usize,
    seeds: &[&[u8]],
) -> ProgramResult {
    let lamports = Rent::get()?.minimum_balance(space);
    solana_program::program::invoke_signed(
        &system_instruction::create_account(
            payer.key,
            account.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[payer.clone(), account.clone(), system.clone()],
        &[seeds],
    )
}

fn pay_native<'a>(
    from: &AccountInfo<'a>,
    to: &AccountInfo<'a>,
    amount: u64,
    system: &AccountInfo<'a>,
) -> ProgramResult {
    if amount == 0 {
        return Ok(());
    }
    invoke(
        &system_instruction::transfer(from.key, to.key, amount),
        &[from.clone(), to.clone(), system.clone()],
    )
}

fn load_challenge(challenge: &AccountInfo) -> Result<ChallengeAccount, ProgramError> {
    ChallengeAccount::try_from_slice(&challenge.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)
}

fn save_challenge(challenge: &AccountInfo, account: &ChallengeAccount) -> ProgramResult {
    let mut data = challenge.try_borrow_mut_data()?;
    account
        .serialize(&mut &mut data[..])
        .map_err(|_| ProgramError::AccountDataTooSmall)
}

/// Accounts: challenger(signer), config, asset, state, challenge, system, payer(signer)
fn open_challenge(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let challenger = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let state = next_account_info(iter)?;
    let challenge_info = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;

    if !challenger.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    let mut st = load_state(program_id, state, &token_id)?;
    let (live, owner) = gate_and_read_owner(asset)?;
    check_open_challenge(live, st.burned, st.custody_locked, st.status)
        .map_err(into_program_error)?;

    let (chkey, chbump) = challenge_pda_for(program_id, &token_id);
    if challenge_info.key != &chkey {
        return Err(ProgramError::InvalidSeeds);
    }
    if !challenge_info.data_is_empty() {
        let existing = load_challenge(challenge_info)?;
        if existing.is_active() {
            return Err(into_program_error(
                kargain_errors::KargainError::DisputeActive,
            ));
        }
    } else {
        create_pda(
            program_id,
            payer,
            challenge_info,
            system,
            ChallengeAccount::SPACE,
            &[CHALLENGE_SEED, &token_id, &[chbump]],
        )?;
    }

    let now = Clock::get()?.unix_timestamp as u64;
    let hooks = PassportHooks {
        state: &mut st,
        asset_owner: owner.to_bytes(),
        dispute_deposit: cfg.dispute_deposit,
        judge_qualified: false,
        pending_withdraw_record: false,
    };
    let ch_cfg = challenge_config_from_passport(&cfg);
    let (account, ev) = run_open_challenge(
        &ch_cfg,
        &hooks,
        token_id,
        challenger.key.to_bytes(),
        cfg.dispute_deposit,
        now,
        chbump,
    )
    .map_err(into_program_error)?;
    pay_native(challenger, challenge_info, cfg.dispute_deposit, system)?;
    save_challenge(challenge_info, &account)?;
    st.status = Status::Disputed;
    save_state(state, &st)?;
    generated::emit_kar_passport_passport_disputed(token_id, challenger.key.to_bytes());
    emit_challenge_event(&ev);
    ops_log!("kar-passport OpenChallenge ok");
    Ok(())
}

/// Accounts: challenger(signer), config, asset, state, challenge, record, system, payer(signer)
fn withdraw_challenge(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let challenger = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let state = next_account_info(iter)?;
    let challenge_info = next_account_info(iter)?;
    let record = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let payer = next_account_info(iter)?;

    if !challenger.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    let mut st = load_state(program_id, state, &token_id)?;
    let (_, owner) = gate_and_read_owner(asset)?;
    let mut account = load_challenge(challenge_info)?;
    let now = Clock::get()?.unix_timestamp as u64;
    let mut hooks = PassportHooks {
        state: &mut st,
        asset_owner: owner.to_bytes(),
        dispute_deposit: cfg.dispute_deposit,
        judge_qualified: false,
        pending_withdraw_record: false,
    };
    let ch_cfg = challenge_config_from_passport(&cfg);
    let (ev, disposition) = run_withdraw_challenge(
        &mut account,
        &mut hooks,
        challenger.key.to_bytes(),
        now,
    )
    .map_err(into_program_error)?;
    {
        let mut from = challenge_info.try_borrow_mut_lamports()?;
        let mut to = challenger.try_borrow_mut_lamports()?;
        crate::challenge::transfer_bond(&mut from, &mut to, disposition.amount)
            .map_err(into_program_error)?;
    }
    save_challenge(challenge_info, &account)?;
    if hooks.pending_withdraw_record {
        append_dispute_withdrawn_record(
            program_id,
            asset,
            &mut st,
            record,
            payer,
            system,
            challenger.key.to_bytes(),
            now,
        )?;
    }
    save_state(state, &st)?;
    emit_verification_stood(token_id);
    emit_challenge_event(&ev);
    ops_log!("kar-passport WithdrawChallenge ok");
    let _ = ch_cfg;
    Ok(())
}

/// Accounts: judge(signer), config, asset, state, challenge, bond_recipient, stake, staking_program, payer(signer)
fn judge_challenge(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    outcome: u8,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let judge = next_account_info(iter)?;
    let config = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let state = next_account_info(iter)?;
    let challenge_info = next_account_info(iter)?;
    let bond_recipient = next_account_info(iter)?;
    let stake = next_account_info(iter)?;
    let staking_program = next_account_info(iter)?;
    let payer = next_account_info(iter)?;

    if !judge.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let outcome = match outcome {
        0 => JudgeOutcome::Upheld,
        1 => JudgeOutcome::Rejected,
        _ => return Err(ProgramError::InvalidInstructionData),
    };
    let cfg = load_config(program_id, config)?;
    if staking_program.key.to_bytes() != cfg.staking_program {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut st = load_state(program_id, state, &token_id)?;
    let (_, owner) = gate_and_read_owner(asset)?;
    let stake_data = if stake.data_is_empty() {
        None
    } else {
        Some(stake.try_borrow_data()?.to_vec())
    };
    let judge_qualified = crate::challenge::require_active_judge(
        stake_data.as_deref(),
        &judge.key.to_bytes(),
        stake.owner == staking_program.key,
        Some(stake.key),
        staking_program.key,
    )
    .map_err(into_program_error)?;
    let mut account = load_challenge(challenge_info)?;
    let now = Clock::get()?.unix_timestamp as u64;
    let mut hooks = PassportHooks {
        state: &mut st,
        asset_owner: owner.to_bytes(),
        dispute_deposit: cfg.dispute_deposit,
        judge_qualified,
        pending_withdraw_record: false,
    };
    let ch_cfg = challenge_config_from_passport(&cfg);
    let (ev, disposition) = run_judge_challenge(
        &mut account,
        &ch_cfg,
        &mut hooks,
        judge.key.to_bytes(),
        outcome,
        now,
    )
    .map_err(into_program_error)?;
    if bond_recipient.key.to_bytes() != disposition.recipient {
        return Err(ProgramError::InvalidAccountData);
    }
    {
        let mut from = challenge_info.try_borrow_mut_lamports()?;
        let mut to = bond_recipient.try_borrow_mut_lamports()?;
        crate::challenge::transfer_bond(&mut from, &mut to, disposition.amount)
            .map_err(into_program_error)?;
    }
    save_challenge(challenge_info, &account)?;
    save_state(state, &st)?;
    match outcome {
        JudgeOutcome::Upheld => emit_verification_lapsed(token_id),
        JudgeOutcome::Rejected => emit_verification_stood(token_id),
    }
    emit_challenge_event(&ev);
    ops_log!("kar-passport JudgeChallenge ok");
    Ok(())
}

/// Accounts: config, asset, state, challenge, bond_recipient, payer(signer)
fn conclude_challenge(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let state = next_account_info(iter)?;
    let challenge_info = next_account_info(iter)?;
    let bond_recipient = next_account_info(iter)?;
    let payer = next_account_info(iter)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    let mut st = load_state(program_id, state, &token_id)?;
    let (_, owner) = gate_and_read_owner(asset)?;
    let mut account = load_challenge(challenge_info)?;
    let now = Clock::get()?.unix_timestamp as u64;
    let mut hooks = PassportHooks {
        state: &mut st,
        asset_owner: owner.to_bytes(),
        dispute_deposit: cfg.dispute_deposit,
        judge_qualified: false,
        pending_withdraw_record: false,
    };
    let ch_cfg = challenge_config_from_passport(&cfg);
    let (ev, disposition) =
        run_conclude_challenge(&mut account, &ch_cfg, &mut hooks, now).map_err(into_program_error)?;
    if bond_recipient.key.to_bytes() != disposition.recipient {
        return Err(ProgramError::InvalidAccountData);
    }
    {
        let mut from = challenge_info.try_borrow_mut_lamports()?;
        let mut to = bond_recipient.try_borrow_mut_lamports()?;
        crate::challenge::transfer_bond(&mut from, &mut to, disposition.amount)
            .map_err(into_program_error)?;
    }
    save_challenge(challenge_info, &account)?;
    save_state(state, &st)?;
    emit_verification_lapsed(token_id);
    emit_challenge_event(&ev);
    ops_log!("kar-passport ConcludeChallenge ok");
    let _ = program_id;
    Ok(())
}

fn set_dispute_deposit(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    dispute_deposit: u64,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let authority = next_account_info(iter)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if dispute_deposit == 0 {
        return Err(into_program_error(
            kargain_errors::KargainError::ZeroDisputeDeposit,
        ));
    }
    let mut cfg = load_config(program_id, config)?;
    if authority.key.to_bytes() != cfg.authority {
        return Err(ProgramError::IllegalOwner);
    }
    let previous = cfg.dispute_deposit;
    cfg.dispute_deposit = dispute_deposit;
    save_config(config, &cfg)?;
    generated::emit_kar_passport_dispute_deposit_updated(previous, dispute_deposit);
    ops_log!("kar-passport SetDisputeDeposit ok");
    Ok(())
}

/// Accounts: asset, state, owner(signer), new_owner, payer, core, system
fn transfer_passport(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let asset = next_account_info(iter)?;
    let state = next_account_info(iter)?;
    let owner = next_account_info(iter)?;
    let new_owner = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let core = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !owner.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let _st = load_state(program_id, state, &token_id)?;
    if !is_live_core_asset(asset) {
        return Err(into_program_error(
            kargain_errors::KargainError::NonexistentToken,
        ));
    }
    let asset_owner = read_owner(asset)?;
    if asset_owner != *owner.key {
        return Err(into_program_error(kargain_errors::KargainError::NotOwner));
    }
    let from_bytes = owner.key.to_bytes();
    transfer_asset(
        asset,
        payer,
        owner,
        new_owner,
        core,
        system,
        None,
    )?;
    generated::emit_kar_passport_transfer(
        from_bytes,
        new_owner.key.to_bytes(),
        token_id,
    );
    ops_log!("kar-passport TransferPassport ok");
    Ok(())
}
