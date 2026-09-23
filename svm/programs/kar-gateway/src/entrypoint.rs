//! BPF entrypoint — clear-before-state receive, URI-before-debit send, recover.

use borsh::BorshDeserialize;
use kargain_onft_codec::{abi_encode_string, encode};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

use crate::account::into_program_error;
use crate::config::{
    load_config, require_config_authority, GatewayConfig, GATEWAY_CONFIG_DISCRIMINATOR,
};
use crate::endpoint_v2::{
    cpi_clear_production, cpi_register_oapp, cpi_send_production, is_production_endpoint,
    ClearParams as EndpointClearParams, SendParams as EndpointSendParams, EVENT_SEED, OAPP_SEED,
};
use crate::instruction::GatewayIx;
use crate::lz_receive_types::{
    lz_receive_types, LzReceiveAccountList, MOCK_LZ_RECEIVE_ACCOUNT_COUNT, MOCK_LZ_RECEIVE_ACCOUNTS,
    PRODUCTION_LZ_RECEIVE_ACCOUNT_COUNT, PRODUCTION_LZ_RECEIVE_ACCOUNTS,
};
use crate::lz_receive_v2::{
    init_lz_receive_types_accounts, try_dispatch_anchor_ix,
};
use crate::peer::{peer_pda, PeerConfig, HUB_EID, PEER_CONFIG_DISCRIMINATOR};
use crate::recover::check_recover_locked_home;
use crate::seeds::{config_pda, freeze_pda, CONFIG_SEED, FREEZE_SEED, PEER_SEED};
use crate::send_receive::{plan_receive, plan_send, ReceiveKind};
use kar_passport::core_asset::{is_live_core_asset, read_owner, read_uri, transfer_asset};
use kar_passport::instruction::PassportIx;
use kar_passport::may::resolve_may_accounts;
use kar_passport::state::{is_home_token, PassportConfig};
use kargain_encumbrance::INTENT_LEAVE_CHAIN;
use kargain_events::generated;
use mock_endpoint::MockEndpointIx;

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if let Some(result) =
        try_dispatch_anchor_ix(program_id, accounts, data, lz_receive)
    {
        return result;
    }
    let ix = GatewayIx::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
    match ix {
        GatewayIx::Initialize {
            local_eid,
            endpoint_program,
            passport_program,
            namespace,
        } => initialize(
            program_id,
            accounts,
            local_eid,
            endpoint_program,
            passport_program,
            namespace,
        ),
        GatewayIx::Send {
            dst_eid,
            to,
            token_id,
            native_fee,
            options,
        } => send(
            program_id,
            accounts,
            dst_eid,
            to,
            token_id,
            native_fee,
            options,
        ),
        GatewayIx::LzReceive {
            src_eid,
            sender,
            nonce,
            guid,
            message,
        } => lz_receive(
            program_id,
            accounts,
            src_eid,
            sender,
            nonce,
            guid,
            message,
        ),
        GatewayIx::RecoverLockedHome { token_id, to } => {
            recover_locked_home(program_id, accounts, token_id, to)
        }
        GatewayIx::LzReceiveTypes { message } => {
            // Host / executor helper: log deterministic accounts (src/sender/nonce = 0 placeholder).
            let cfg_ai = accounts
                .first()
                .ok_or(ProgramError::NotEnoughAccountKeys)?;
            let cfg = load_config(program_id, cfg_ai)?;
            let list = lz_receive_types(program_id, &cfg, &message, 0, [0u8; 32], 0)
                .map_err(into_program_error)?;
            match list {
                LzReceiveAccountList::Mock(list) => {
                    msg!(
                        "lz_receive_types mock asset={} state={} freeze={}",
                        list.asset,
                        list.state,
                        list.freeze_authority
                    );
                }
                LzReceiveAccountList::Production(list) => {
                    msg!(
                        "lz_receive_types production asset={} state={} freeze={} clear_payload={}",
                        list.asset,
                        list.state,
                        list.freeze_authority,
                        list.clear.payload_hash
                    );
                }
            }
            Ok(())
        }
        GatewayIx::RegisterOApp { delegate } => register_oapp(program_id, accounts, delegate),
        GatewayIx::SetPeer { remote_eid, peer } => {
            set_peer(program_id, accounts, remote_eid, peer)
        }
        GatewayIx::InitLzReceiveTypes => init_lz_receive_types_accounts(program_id, accounts),
    }
}

fn initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    local_eid: u32,
    endpoint_program: [u8; 32],
    passport_program: [u8; 32],
    namespace: u128,
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
    let (_, freeze_bump) = freeze_pda(program_id);
    let record = GatewayConfig {
        discriminator: GATEWAY_CONFIG_DISCRIMINATOR,
        authority: authority.key.to_bytes(),
        local_eid,
        endpoint_program,
        passport_program,
        namespace,
        bump,
        freeze_bump,
    };
    let encoded = borsh::to_vec(&record).map_err(|_| ProgramError::InvalidAccountData)?;
    let lamports = Rent::get()?.minimum_balance(encoded.len());
    invoke_signed(
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
    msg!("kar-gateway Initialize ok");
    Ok(())
}

/// CPI mock-endpoint Clear — MUST run before any Kargain state mutation.
fn cpi_clear_mock<'info>(
    endpoint_program: &AccountInfo<'info>,
    endpoint_config: &AccountInfo<'info>,
    oapp: &AccountInfo<'info>,
    clear_receipt: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    src_eid: u32,
    sender: [u8; 32],
    nonce: u64,
    guid: [u8; 32],
    gateway_config_bump: u8,
) -> ProgramResult {
    let data = borsh::to_vec(&MockEndpointIx::Clear {
        src_eid,
        sender,
        nonce,
        guid,
    })
    .map_err(|_| ProgramError::InvalidInstructionData)?;
    let ix = Instruction {
        program_id: *endpoint_program.key,
        accounts: vec![
            AccountMeta::new_readonly(*endpoint_config.key, false),
            AccountMeta::new_readonly(*oapp.key, true),
            AccountMeta::new(*clear_receipt.key, false),
            AccountMeta::new(*payer.key, true),
            AccountMeta::new_readonly(*system.key, false),
        ],
        data,
    };
    invoke_signed(
        &ix,
        &[
            endpoint_config.clone(),
            oapp.clone(),
            clear_receipt.clone(),
            payer.clone(),
            system.clone(),
            endpoint_program.clone(),
        ],
        &[&[CONFIG_SEED, &[gateway_config_bump]]],
    )?;
    msg!("kar-gateway clear ok src_eid={} nonce={}", src_eid, nonce);
    Ok(())
}

fn cpi_passport<'info>(
    passport_program: &AccountInfo<'info>,
    accounts: &[AccountInfo<'info>],
    ix: PassportIx,
    signer_seeds: &[&[&[u8]]],
    force_signers: &[&Pubkey],
) -> ProgramResult {
    let data = borsh::to_vec(&ix).map_err(|_| ProgramError::InvalidInstructionData)?;
    let metas: Vec<AccountMeta> = accounts
        .iter()
        .map(|a| {
            let is_signer = a.is_signer || force_signers.iter().any(|k| *k == a.key);
            if a.is_writable {
                AccountMeta::new(*a.key, is_signer)
            } else {
                AccountMeta::new_readonly(*a.key, is_signer)
            }
        })
        .collect();
    let instruction = Instruction {
        program_id: *passport_program.key,
        accounts: metas,
        data,
    };
    let mut infos = accounts.to_vec();
    infos.push(passport_program.clone());
    invoke_signed(&instruction, &infos, signer_seeds)?;
    Ok(())
}

fn lz_receive(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    src_eid: u32,
    sender: [u8; 32],
    nonce: u64,
    guid: [u8; 32],
    message: Vec<u8>,
) -> ProgramResult {
    // Resolve config by PDA identity (layouts differ: mock gateway@0, production gateway@1).
    let (expected_config, _) = config_pda(program_id);
    let gateway_config = accounts
        .iter()
        .find(|a| a.key == &expected_config)
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    let cfg = load_config(program_id, gateway_config)?;
    let endpoint_key = Pubkey::new_from_array(cfg.endpoint_program);
    let production = is_production_endpoint(&endpoint_key);

    let (payer, endpoint_program, system, passport_program, passport_config, asset, state, freeze, core, to) =
        if production {
            if accounts.len() < PRODUCTION_LZ_RECEIVE_ACCOUNT_COUNT {
                return Err(ProgramError::NotEnoughAccountKeys);
            }
            let a = PRODUCTION_LZ_RECEIVE_ACCOUNTS;
            (
                &accounts[a.payer],
                &accounts[a.clear_endpoint_program],
                &accounts[a.system_program],
                &accounts[a.passport_program],
                &accounts[a.passport_config],
                &accounts[a.asset],
                &accounts[a.state],
                &accounts[a.freeze_authority],
                &accounts[a.core_program],
                &accounts[a.to],
            )
        } else {
            if accounts.len() < MOCK_LZ_RECEIVE_ACCOUNT_COUNT {
                return Err(ProgramError::NotEnoughAccountKeys);
            }
            let a = MOCK_LZ_RECEIVE_ACCOUNTS;
            (
                &accounts[a.payer],
                &accounts[a.endpoint_program],
                &accounts[a.system_program],
                &accounts[a.passport_program],
                &accounts[a.passport_config],
                &accounts[a.asset],
                &accounts[a.state],
                &accounts[a.freeze_authority],
                &accounts[a.core_program],
                &accounts[a.to],
            )
        };

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if endpoint_program.key.to_bytes() != cfg.endpoint_program {
        return Err(ProgramError::IncorrectProgramId);
    }
    if passport_program.key.to_bytes() != cfg.passport_program {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (freeze_key, freeze_bump) = freeze_pda(program_id);
    if freeze.key != &freeze_key {
        return Err(ProgramError::InvalidSeeds);
    }
    if gateway_config.key != &expected_config {
        return Err(ProgramError::InvalidSeeds);
    }

    // Production: peer authorisation from Origin.sender (never composeFrom) — SPEC §I.13.3.
    if production {
        let a = PRODUCTION_LZ_RECEIVE_ACCOUNTS;
        let (expected_peer, _) = peer_pda(program_id, gateway_config.key, src_eid);
        let peer_ai = &accounts[a.peer_config];
        if peer_ai.key != &expected_peer {
            return Err(ProgramError::InvalidSeeds);
        }
        if peer_ai.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        let peer = PeerConfig::try_from_slice(&peer_ai.try_borrow_data()?)
            .map_err(|_| ProgramError::InvalidAccountData)?;
        if peer.discriminator != PEER_CONFIG_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        if peer.peer_address != sender {
            return Err(ProgramError::InvalidArgument);
        }
    }

    // 1) Clear FIRST — before decode side-effects / any passport CPI.
    let config_seeds: &[&[u8]] = &[CONFIG_SEED, &[cfg.bump]];
    if production {
        let a = PRODUCTION_LZ_RECEIVE_ACCOUNTS;
        if accounts[a.gateway_config].key != gateway_config.key {
            return Err(ProgramError::InvalidArgument);
        }
        if accounts[a.clear_receiver].key != gateway_config.key {
            return Err(ProgramError::InvalidArgument);
        }
        cpi_clear_production(
            endpoint_program,
            gateway_config,
            &accounts[a.clear_oapp_registry],
            &accounts[a.clear_nonce],
            &accounts[a.clear_payload_hash],
            &accounts[a.clear_endpoint_settings],
            &accounts[a.clear_event_authority],
            &EndpointClearParams {
                receiver: *gateway_config.key,
                src_eid,
                sender,
                nonce,
                guid,
                message: message.clone(),
            },
            config_seeds,
        )?;
    } else {
        let a = MOCK_LZ_RECEIVE_ACCOUNTS;
        cpi_clear_mock(
            endpoint_program,
            &accounts[a.endpoint_config],
            gateway_config,
            &accounts[a.clear_receipt],
            payer,
            system,
            src_eid,
            sender,
            nonce,
            guid,
            cfg.bump,
        )?;
    }

    // 2) Decode fail-closed (D-16).
    let (_decoded, kind) =
        plan_receive(&message, cfg.namespace).map_err(into_program_error)?;

    let freeze_seeds: &[&[u8]] = &[FREEZE_SEED, &[freeze_bump]];

    match kind {
        ReceiveKind::MintForeign { to: to_bytes, uri } => {
            if to.key.to_bytes() != to_bytes {
                return Err(ProgramError::InvalidArgument);
            }
            let token_id = _decoded.token_id;
            cpi_passport(
                passport_program,
                &[
                    passport_config.clone(),
                    gateway_config.clone(),
                    asset.clone(),
                    state.clone(),
                    payer.clone(),
                    to.clone(),
                    freeze.clone(),
                    core.clone(),
                    system.clone(),
                ],
                PassportIx::BridgeMint {
                    to: to_bytes,
                    token_id,
                    uri,
                },
                &[config_seeds],
                &[gateway_config.key],
            )?;
        }
        ReceiveKind::UnlockHome { to: to_bytes, uri } => {
            if to.key.to_bytes() != to_bytes {
                return Err(ProgramError::InvalidArgument);
            }
            let token_id = _decoded.token_id;
            cpi_passport(
                passport_program,
                &[
                    passport_config.clone(),
                    gateway_config.clone(),
                    asset.clone(),
                    state.clone(),
                    payer.clone(),
                    freeze.clone(),
                    core.clone(),
                    system.clone(),
                ],
                PassportIx::BridgeResetOnUnlock { token_id, uri },
                &[config_seeds, freeze_seeds],
                &[gateway_config.key, freeze.key],
            )?;
            transfer_asset(
                asset,
                payer,
                gateway_config,
                to,
                core,
                system,
                Some(config_seeds),
            )?;
        }
    }
    let token_id = _decoded.token_id;
    kargain_events::generated::emit_kar_passport_bridge_gateway_onftreceived(
        guid,
        src_eid,
        to.key.to_bytes(),
        token_id,
    );
    kargain_events::ops_log!("kar-gateway LzReceive ok");
    Ok(())
}

/// Send accounts (mock):
/// 0 gateway_config, 1 owner(signer), 2 payer(signer), 3 passport_program,
/// 4 passport_config, 5 asset, 6 state, 7 freeze, 8 core, 9 system,
/// 10 challenge PDA, 11..10+N answer accounts (N = registry len; empty ⇒ challenge only)
///
/// Production adds after the may tail:
/// peer_config, then Endpoint send metas after sender (SendHelper.slice(2))
fn send(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    dst_eid: u32,
    to: [u8; 32],
    token_id: [u8; 32],
    native_fee: u64,
    options: Vec<u8>,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let gateway_config = next_account_info(iter)?;
    let owner = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let passport_program = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let state = next_account_info(iter)?;
    let freeze = next_account_info(iter)?;
    let core = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !owner.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, gateway_config)?;
    if passport_program.key.to_bytes() != cfg.passport_program {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (freeze_key, freeze_bump) = freeze_pda(program_id);
    if freeze.key != &freeze_key {
        return Err(ProgramError::InvalidSeeds);
    }

    let endpoint_key = Pubkey::new_from_array(cfg.endpoint_program);
    let production = is_production_endpoint(&endpoint_key);

    // URI **before** debit (SPEC §13.3a).
    let uri = read_uri(asset).map_err(|_| {
        into_program_error(kargain_errors::KargainError::NonexistentToken)
    })?;

    let is_home = is_home_token(&token_id, cfg.namespace);
    // Real may(LeaveChain): challenge + answer tail after system (index 10+).
    let passport_cfg = PassportConfig::try_from_slice(&passport_config.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let n = passport_cfg.encumbrance_sources.len();
    let may_tail_len = 1 + n;
    if accounts.len() < 10 + may_tail_len {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let mut may_accounts: Vec<AccountInfo> = Vec::with_capacity(3 + n);
    may_accounts.push(passport_config.clone());
    may_accounts.push(asset.clone());
    may_accounts.push(accounts[10].clone()); // challenge
    for i in 0..n {
        may_accounts.push(accounts[11 + i].clone());
    }
    let may = resolve_may_accounts(
        passport_program.key,
        &may_accounts,
        token_id,
        INTENT_LEAVE_CHAIN,
    )?;
    let owner_ok = read_owner(asset)
        .map(|o| o == *owner.key)
        .unwrap_or(false);
    let plan = plan_send(uri.clone(), token_id, is_home, Ok(may), owner_ok).map_err(into_program_error)?;

    let config_seeds: &[&[u8]] = &[CONFIG_SEED, &[cfg.bump]];
    let freeze_seeds: &[&[u8]] = &[FREEZE_SEED, &[freeze_bump]];

    if plan.is_home {
        // Debit home: transfer → gateway config, then custody lock + freeze.
        transfer_asset(
            asset,
            payer,
            owner,
            gateway_config,
            core,
            system,
            None,
        )?;
        cpi_passport(
            passport_program,
            &[
                passport_config.clone(),
                gateway_config.clone(),
                asset.clone(),
                state.clone(),
                payer.clone(),
                freeze.clone(),
                core.clone(),
                system.clone(),
            ],
            PassportIx::SetCustodyLock {
                token_id,
                locked: true,
            },
            &[config_seeds, freeze_seeds],
            &[gateway_config.key, freeze.key],
        )?;
    } else {
        cpi_passport(
            passport_program,
            &[
                passport_config.clone(),
                gateway_config.clone(),
                asset.clone(),
                state.clone(),
                payer.clone(),
                owner.clone(),
                freeze.clone(),
                core.clone(),
                system.clone(),
            ],
            PassportIx::BridgeBurn { token_id },
            &[config_seeds, freeze_seeds],
            &[gateway_config.key, freeze.key],
        )?;
    }

    // Always compose abi.encode(uri).
    let composed = abi_encode_string(&plan.uri);
    let (message, _) = encode(to, token_id, Some(&composed));
    let msg_len = message.len();
    let uri_len = plan.uri.len();

    let production_start = 10 + may_tail_len;
    if production {
        if dst_eid != HUB_EID {
            return Err(ProgramError::InvalidArgument);
        }
        if accounts.len() <= production_start {
            return Err(ProgramError::NotEnoughAccountKeys);
        }
        let peer_ai = &accounts[production_start];
        let (expected_peer, _) = peer_pda(program_id, gateway_config.key, dst_eid);
        if peer_ai.key != &expected_peer {
            return Err(ProgramError::InvalidSeeds);
        }
        if peer_ai.owner != program_id {
            return Err(ProgramError::IncorrectProgramId);
        }
        let peer = PeerConfig::try_from_slice(&peer_ai.try_borrow_data()?)
            .map_err(|_| ProgramError::InvalidAccountData)?;
        if peer.discriminator != PEER_CONFIG_DISCRIMINATOR {
            return Err(ProgramError::InvalidAccountData);
        }
        // Remaining = Endpoint send metas after sender (no leading program, no sender).
        let endpoint_accounts: Vec<AccountInfo> = accounts[production_start + 1..].to_vec();
        let endpoint_program_ai = endpoint_accounts
            .iter()
            .find(|a| a.key == &endpoint_key)
            .ok_or(ProgramError::NotEnoughAccountKeys)?;
        cpi_send_production(
            endpoint_program_ai,
            gateway_config,
            &endpoint_accounts,
            &EndpointSendParams {
                dst_eid,
                receiver: peer.peer_address,
                message,
                options,
                native_fee,
            },
            config_seeds,
        )?;
    } else {
        let _ = (native_fee, options); // mock ignores fee/options
        solana_program::program::set_return_data(&message);
    }
    generated::emit_kar_passport_bridge_gateway_onftsent(
        [0u8; 32],
        dst_eid,
        owner.key.to_bytes(),
        token_id,
    );
    kargain_events::ops_log!(
        "kar-gateway Send ok dst_eid={} uri_len={} msg_len={}",
        dst_eid,
        uri_len,
        msg_len
    );
    Ok(())
}

/// Recover accounts:
/// 0 gateway_config, 1 authority(signer), 2 payer, 3 passport_program, 4 passport_config,
/// 5 asset, 6 state, 7 freeze, 8 core, 9 system, 10 to
fn recover_locked_home(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    token_id: [u8; 32],
    to: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let gateway_config = next_account_info(iter)?;
    let authority = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let passport_program = next_account_info(iter)?;
    let passport_config = next_account_info(iter)?;
    let asset = next_account_info(iter)?;
    let state = next_account_info(iter)?;
    let freeze = next_account_info(iter)?;
    let core = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let to_ai = next_account_info(iter)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = require_config_authority(program_id, gateway_config, authority)?;
    if to_ai.key.to_bytes() != to {
        return Err(ProgramError::InvalidArgument);
    }
    let (freeze_key, freeze_bump) = freeze_pda(program_id);
    if freeze.key != &freeze_key {
        return Err(ProgramError::InvalidSeeds);
    }

    let is_home = is_home_token(&token_id, cfg.namespace);
    let gateway_holds = is_live_core_asset(asset)
        && read_owner(asset)
            .map(|o| o == *gateway_config.key)
            .unwrap_or(false);
    check_recover_locked_home(&to, is_home, gateway_holds, token_id).map_err(into_program_error)?;

    let config_seeds: &[&[u8]] = &[CONFIG_SEED, &[cfg.bump]];
    let freeze_seeds: &[&[u8]] = &[FREEZE_SEED, &[freeze_bump]];

    cpi_passport(
        passport_program,
        &[
            passport_config.clone(),
            gateway_config.clone(),
            asset.clone(),
            state.clone(),
            payer.clone(),
            freeze.clone(),
            core.clone(),
            system.clone(),
        ],
        PassportIx::BridgeResetOnUnlock {
            token_id,
            uri: String::new(),
        },
        &[config_seeds, freeze_seeds],
        &[gateway_config.key, freeze.key],
    )?;
    transfer_asset(
        asset,
        payer,
        gateway_config,
        to_ai,
        core,
        system,
        Some(config_seeds),
    )?;
    msg!("kar-gateway RecoverLockedHome ok");
    Ok(())
}

/// RegisterOApp accounts:
/// 0 gateway_config, 1 authority_payer(signer mut), 2 endpoint_program,
/// 3 oapp_registry (init), 4 system, 5 event_authority
///
/// Single signer account (authority ≡ payer) — avoids duplicate-key CPI quirks
/// and matches OFT init (one payer signs register_oapp).
fn register_oapp(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    delegate: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let gateway_config = next_account_info(iter)?;
    let authority_payer = next_account_info(iter)?;
    let endpoint_program = next_account_info(iter)?;
    let oapp_registry = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let event_authority = next_account_info(iter)?;

    let cfg = require_config_authority(program_id, gateway_config, authority_payer)?;
    if endpoint_program.key.to_bytes() != cfg.endpoint_program {
        return Err(ProgramError::IncorrectProgramId);
    }
    if !is_production_endpoint(endpoint_program.key) {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (expected_registry, _) =
        Pubkey::find_program_address(&[OAPP_SEED, gateway_config.key.as_ref()], endpoint_program.key);
    if oapp_registry.key != &expected_registry {
        return Err(ProgramError::InvalidSeeds);
    }
    let (expected_event, _) =
        Pubkey::find_program_address(&[EVENT_SEED], endpoint_program.key);
    if event_authority.key != &expected_event {
        return Err(ProgramError::InvalidSeeds);
    }

    let config_seeds: &[&[u8]] = &[CONFIG_SEED, &[cfg.bump]];
    cpi_register_oapp(
        endpoint_program,
        authority_payer,
        gateway_config,
        oapp_registry,
        system,
        event_authority,
        delegate,
        config_seeds,
    )?;
    Ok(())
}

/// SetPeer accounts: 0 gateway_config, 1 authority(signer), 2 peer_config (init), 3 payer, 4 system
fn set_peer(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    remote_eid: u32,
    peer: [u8; 32],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let gateway_config = next_account_info(iter)?;
    let authority = next_account_info(iter)?;
    let peer_config_ai = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = require_config_authority(program_id, gateway_config, authority)?;
    // Star topology: Solana spoke may only peer with the hub.
    if remote_eid != HUB_EID {
        return Err(ProgramError::InvalidArgument);
    }
    if peer == [0u8; 32] {
        return Err(ProgramError::InvalidArgument);
    }

    let (expected_peer, bump) = peer_pda(program_id, gateway_config.key, remote_eid);
    if peer_config_ai.key != &expected_peer {
        return Err(ProgramError::InvalidSeeds);
    }

    let record = PeerConfig::new(peer, bump);
    let encoded = borsh::to_vec(&record).map_err(|_| ProgramError::InvalidInstructionData)?;

    if peer_config_ai.data_is_empty() {
        let lamports = Rent::get()?.minimum_balance(encoded.len());
        invoke_signed(
            &system_instruction::create_account(
                payer.key,
                peer_config_ai.key,
                lamports,
                encoded.len() as u64,
                program_id,
            ),
            &[payer.clone(), peer_config_ai.clone(), system.clone()],
            &[&[
                PEER_SEED,
                gateway_config.key.as_ref(),
                &remote_eid.to_be_bytes(),
                &[bump],
            ]],
        )?;
    } else if peer_config_ai.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    let mut data = peer_config_ai.try_borrow_mut_data()?;
    if data.len() < encoded.len() {
        return Err(ProgramError::AccountDataTooSmall);
    }
    data[..encoded.len()].copy_from_slice(&encoded);
    msg!(
        "kar-gateway SetPeer ok remote_eid={} peer={}",
        remote_eid,
        Pubkey::new_from_array(peer)
    );
    Ok(())
}

#[cfg(test)]
mod admin_admit_tests {
    use super::*;
    use kargain_errors::KargainError;
    use solana_program::pubkey::Pubkey;

    fn pid() -> Pubkey {
        Pubkey::new_from_array([9u8; 32])
    }
    fn auth() -> Pubkey {
        Pubkey::new_from_array([1u8; 32])
    }
    fn wrong() -> Pubkey {
        Pubkey::new_from_array([2u8; 32])
    }
    fn not_owner() -> ProgramError {
        ProgramError::Custom(u32::from(KargainError::NotOwner))
    }
    fn ai<'a>(
        key: &'a Pubkey,
        is_signer: bool,
        writable: bool,
        lamports: &'a mut u64,
        data: &'a mut [u8],
        owner: &'a Pubkey,
    ) -> AccountInfo<'a> {
        AccountInfo::new(key, is_signer, writable, lamports, data, owner, false, 0)
    }
    fn cfg_bytes(program_id: &Pubkey, authority: &Pubkey) -> (Pubkey, Vec<u8>) {
        let (key, bump) = config_pda(program_id);
        let cfg = GatewayConfig {
            discriminator: GATEWAY_CONFIG_DISCRIMINATOR,
            authority: authority.to_bytes(),
            local_eid: 1,
            endpoint_program: [3u8; 32],
            passport_program: [4u8; 32],
            namespace: 1,
            bump,
            freeze_bump: 255,
        };
        (key, borsh::to_vec(&cfg).unwrap())
    }

    #[test]
    fn recover_locked_home_unsigned_wrong_admit_passed() {
        let program_id = pid();
        let authority = auth();
        let (cfg_key, mut cfg_data) = cfg_bytes(&program_id, &authority);
        let mut cl = 0u64;
        let mut al = 0u64;
        let mut pl = 0u64;
        let mut l0 = 0u64;
        let mut l1 = 0u64;
        let mut l2 = 0u64;
        let mut l3 = 0u64;
        let mut l4 = 0u64;
        let mut l5 = 0u64;
        let mut l6 = 0u64;
        let mut l7 = 0u64;
        let k0 = Pubkey::new_from_array([10u8; 32]);
        let k1 = Pubkey::new_from_array([11u8; 32]);
        let k2 = Pubkey::new_from_array([12u8; 32]);
        let k3 = Pubkey::new_from_array([13u8; 32]);
        let k4 = Pubkey::new_from_array([14u8; 32]);
        let k5 = Pubkey::new_from_array([15u8; 32]);
        let k6 = Pubkey::new_from_array([16u8; 32]);
        let k7 = Pubkey::new_from_array([17u8; 32]);
        let mut d0: [u8; 0] = [];
        let mut d1: [u8; 0] = [];
        let mut d2: [u8; 0] = [];
        let mut d3: [u8; 0] = [];
        let mut d4: [u8; 0] = [];
        let mut d5: [u8; 0] = [];
        let mut d6: [u8; 0] = [];
        let mut d7: [u8; 0] = [];
        let mut da: [u8; 0] = [];
        let mut dp: [u8; 0] = [];
        let to = [9u8; 32];
        {
            let accs = [
                ai(&cfg_key, false, true, &mut cl, &mut cfg_data, &program_id),
                ai(&authority, false, false, &mut al, &mut da, &program_id),
                ai(&authority, true, true, &mut pl, &mut dp, &program_id),
                ai(&k0, false, false, &mut l0, &mut d0, &program_id),
                ai(&k1, false, false, &mut l1, &mut d1, &program_id),
                ai(&k2, false, false, &mut l2, &mut d2, &program_id),
                ai(&k3, false, false, &mut l3, &mut d3, &program_id),
                ai(&k4, false, false, &mut l4, &mut d4, &program_id),
                ai(&k5, false, false, &mut l5, &mut d5, &program_id),
                ai(&k6, false, false, &mut l6, &mut d6, &program_id),
                ai(&k7, false, false, &mut l7, &mut d7, &program_id),
            ];
            assert_eq!(
                recover_locked_home(&program_id, &accs, [1u8; 32], to).unwrap_err(),
                ProgramError::MissingRequiredSignature,
            );
        }
        {
            let w = wrong();
            let accs = [
                ai(&cfg_key, false, true, &mut cl, &mut cfg_data, &program_id),
                ai(&w, true, false, &mut al, &mut da, &program_id),
                ai(&authority, true, true, &mut pl, &mut dp, &program_id),
                ai(&k0, false, false, &mut l0, &mut d0, &program_id),
                ai(&k1, false, false, &mut l1, &mut d1, &program_id),
                ai(&k2, false, false, &mut l2, &mut d2, &program_id),
                ai(&k3, false, false, &mut l3, &mut d3, &program_id),
                ai(&k4, false, false, &mut l4, &mut d4, &program_id),
                ai(&k5, false, false, &mut l5, &mut d5, &program_id),
                ai(&k6, false, false, &mut l6, &mut d6, &program_id),
                ai(&k7, false, false, &mut l7, &mut d7, &program_id),
            ];
            assert_eq!(
                recover_locked_home(&program_id, &accs, [1u8; 32], to).unwrap_err(),
                not_owner(),
            );
        }
        {
            let accs = [
                ai(&cfg_key, false, true, &mut cl, &mut cfg_data, &program_id),
                ai(&authority, true, false, &mut al, &mut da, &program_id),
                ai(&authority, true, true, &mut pl, &mut dp, &program_id),
                ai(&k0, false, false, &mut l0, &mut d0, &program_id),
                ai(&k1, false, false, &mut l1, &mut d1, &program_id),
                ai(&k2, false, false, &mut l2, &mut d2, &program_id),
                ai(&k3, false, false, &mut l3, &mut d3, &program_id),
                ai(&k4, false, false, &mut l4, &mut d4, &program_id),
                ai(&k5, false, false, &mut l5, &mut d5, &program_id),
                ai(&k6, false, false, &mut l6, &mut d6, &program_id),
                ai(&k7, false, false, &mut l7, &mut d7, &program_id),
            ];
            assert_eq!(
                recover_locked_home(&program_id, &accs, [1u8; 32], to).unwrap_err(),
                ProgramError::InvalidArgument,
            );
        }
    }

    #[test]
    fn register_oapp_unsigned_wrong_admit_passed() {
        let program_id = pid();
        let authority = auth();
        let (cfg_key, mut cfg_data) = cfg_bytes(&program_id, &authority);
        let mut cl = 0u64;
        let mut al = 0u64;
        let mut l2 = 0u64;
        let mut l3 = 0u64;
        let mut l4 = 0u64;
        let mut l5 = 0u64;
        let mut da: [u8; 0] = [];
        let mut d2: [u8; 0] = [];
        let mut d3: [u8; 0] = [];
        let mut d4: [u8; 0] = [];
        let mut d5: [u8; 0] = [];
        let k2 = Pubkey::new_from_array([20u8; 32]);
        let k3 = Pubkey::new_from_array([21u8; 32]);
        let k4 = Pubkey::new_from_array([22u8; 32]);
        let k5 = Pubkey::new_from_array([23u8; 32]);
        {
            let accs = [
                ai(&cfg_key, false, true, &mut cl, &mut cfg_data, &program_id),
                ai(&authority, false, true, &mut al, &mut da, &program_id),
                ai(&k2, false, false, &mut l2, &mut d2, &program_id),
                ai(&k3, false, true, &mut l3, &mut d3, &program_id),
                ai(&k4, false, false, &mut l4, &mut d4, &program_id),
                ai(&k5, false, false, &mut l5, &mut d5, &program_id),
            ];
            assert_eq!(
                register_oapp(&program_id, &accs, [1u8; 32]).unwrap_err(),
                ProgramError::MissingRequiredSignature,
            );
        }
        {
            let w = wrong();
            let accs = [
                ai(&cfg_key, false, true, &mut cl, &mut cfg_data, &program_id),
                ai(&w, true, true, &mut al, &mut da, &program_id),
                ai(&k2, false, false, &mut l2, &mut d2, &program_id),
                ai(&k3, false, true, &mut l3, &mut d3, &program_id),
                ai(&k4, false, false, &mut l4, &mut d4, &program_id),
                ai(&k5, false, false, &mut l5, &mut d5, &program_id),
            ];
            assert_eq!(
                register_oapp(&program_id, &accs, [1u8; 32]).unwrap_err(),
                not_owner(),
            );
        }
        {
            let accs = [
                ai(&cfg_key, false, true, &mut cl, &mut cfg_data, &program_id),
                ai(&authority, true, true, &mut al, &mut da, &program_id),
                ai(&k2, false, false, &mut l2, &mut d2, &program_id),
                ai(&k3, false, true, &mut l3, &mut d3, &program_id),
                ai(&k4, false, false, &mut l4, &mut d4, &program_id),
                ai(&k5, false, false, &mut l5, &mut d5, &program_id),
            ];
            assert_eq!(
                register_oapp(&program_id, &accs, [1u8; 32]).unwrap_err(),
                ProgramError::IncorrectProgramId,
            );
        }
    }

    #[test]
    fn set_peer_unsigned_wrong_admit_passed() {
        let program_id = pid();
        let authority = auth();
        let (cfg_key, mut cfg_data) = cfg_bytes(&program_id, &authority);
        let mut cl = 0u64;
        let mut al = 0u64;
        let mut pl = 0u64;
        let mut l2 = 0u64;
        let mut l4 = 0u64;
        let mut da: [u8; 0] = [];
        let mut dp: [u8; 0] = [];
        let mut d2: [u8; 0] = [];
        let mut d4: [u8; 0] = [];
        let k2 = Pubkey::new_from_array([30u8; 32]);
        let k4 = Pubkey::new_from_array([31u8; 32]);
        {
            let accs = [
                ai(&cfg_key, false, true, &mut cl, &mut cfg_data, &program_id),
                ai(&authority, false, false, &mut al, &mut da, &program_id),
                ai(&k2, false, true, &mut l2, &mut d2, &program_id),
                ai(&authority, true, true, &mut pl, &mut dp, &program_id),
                ai(&k4, false, false, &mut l4, &mut d4, &program_id),
            ];
            assert_eq!(
                set_peer(&program_id, &accs, 0, [1u8; 32]).unwrap_err(),
                ProgramError::MissingRequiredSignature,
            );
        }
        {
            let w = wrong();
            let accs = [
                ai(&cfg_key, false, true, &mut cl, &mut cfg_data, &program_id),
                ai(&w, true, false, &mut al, &mut da, &program_id),
                ai(&k2, false, true, &mut l2, &mut d2, &program_id),
                ai(&authority, true, true, &mut pl, &mut dp, &program_id),
                ai(&k4, false, false, &mut l4, &mut d4, &program_id),
            ];
            assert_eq!(
                set_peer(&program_id, &accs, 0, [1u8; 32]).unwrap_err(),
                not_owner(),
            );
        }
        {
            let accs = [
                ai(&cfg_key, false, true, &mut cl, &mut cfg_data, &program_id),
                ai(&authority, true, false, &mut al, &mut da, &program_id),
                ai(&k2, false, true, &mut l2, &mut d2, &program_id),
                ai(&authority, true, true, &mut pl, &mut dp, &program_id),
                ai(&k4, false, false, &mut l4, &mut d4, &program_id),
            ];
            assert_eq!(
                set_peer(&program_id, &accs, 0, [1u8; 32]).unwrap_err(),
                ProgramError::InvalidArgument,
            );
        }
    }
}
