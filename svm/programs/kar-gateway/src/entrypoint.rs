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
use crate::config::{GatewayConfig, GATEWAY_CONFIG_DISCRIMINATOR};
use crate::instruction::GatewayIx;
use crate::lz_receive_types::{lz_receive_types, LZ_RECEIVE_ACCOUNTS, LZ_RECEIVE_ACCOUNT_COUNT};
use crate::recover::check_recover_locked_home;
use crate::seeds::{config_pda, freeze_pda, CONFIG_SEED, FREEZE_SEED};
use crate::send_receive::{plan_receive, plan_send, ReceiveKind};
use kar_passport::core_asset::{is_live_core_asset, read_owner, read_uri, transfer_asset};
use kar_passport::instruction::PassportIx;
use kar_passport::may::may_leave_or_open;
use kar_passport::state::is_home_token;
use mock_endpoint::MockEndpointIx;

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
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
        } => send(program_id, accounts, dst_eid, to, token_id),
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
            msg!(
                "lz_receive_types asset={} state={} freeze={}",
                list.asset,
                list.state,
                list.freeze_authority
            );
            Ok(())
        }
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

fn load_config(program_id: &Pubkey, config: &AccountInfo) -> Result<GatewayConfig, ProgramError> {
    let (expected, _) = config_pda(program_id);
    if config.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if config.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    GatewayConfig::try_from_slice(&config.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)
}

/// CPI mock-endpoint Clear — MUST run before any Kargain state mutation.
fn cpi_clear<'info>(
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
    if accounts.len() < LZ_RECEIVE_ACCOUNT_COUNT {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let a = LZ_RECEIVE_ACCOUNTS;
    let gateway_config = &accounts[a.gateway_config];
    let payer = &accounts[a.payer];
    let endpoint_program = &accounts[a.endpoint_program];
    let endpoint_config = &accounts[a.endpoint_config];
    let clear_receipt = &accounts[a.clear_receipt];
    let system = &accounts[a.system_program];
    let passport_program = &accounts[a.passport_program];
    let passport_config = &accounts[a.passport_config];
    let asset = &accounts[a.asset];
    let state = &accounts[a.state];
    let freeze = &accounts[a.freeze_authority];
    let core = &accounts[a.core_program];
    let to = &accounts[a.to];

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, gateway_config)?;
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

    // 1) Clear FIRST — before decode side-effects / any passport CPI.
    cpi_clear(
        endpoint_program,
        endpoint_config,
        gateway_config, // oapp signer = gateway config PDA
        clear_receipt,
        payer,
        system,
        src_eid,
        sender,
        nonce,
        guid,
        cfg.bump,
    )?;

    // 2) Decode fail-closed (D-16).
    let (_decoded, kind) =
        plan_receive(&message, cfg.namespace).map_err(into_program_error)?;

    let config_seeds: &[&[u8]] = &[CONFIG_SEED, &[cfg.bump]];
    let freeze_seeds: &[&[u8]] = &[FREEZE_SEED, &[freeze_bump]];

    match kind {
        ReceiveKind::MintForeign { to: to_bytes, uri } => {
            if to.key.to_bytes() != to_bytes {
                return Err(ProgramError::InvalidArgument);
            }
            let token_id = _decoded.token_id;
            // gateway(signer via config), freeze elevated for any future lock; mint frozen=false.
            cpi_passport(
                passport_program,
                &[
                    passport_config.clone(),
                    gateway_config.clone(), // gateway signer
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
            // Transfer custody from gateway config PDA → recipient.
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
    msg!("kar-gateway LzReceive ok");
    Ok(())
}

/// Send accounts:
/// 0 gateway_config, 1 owner(signer), 2 payer(signer), 3 passport_program,
/// 4 passport_config, 5 asset, 6 state, 7 freeze, 8 core, 9 system
fn send(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    dst_eid: u32,
    to: [u8; 32],
    token_id: [u8; 32],
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

    // URI **before** debit (SPEC §13.3a).
    let uri = read_uri(asset).map_err(|_| {
        into_program_error(kargain_errors::KargainError::NonexistentToken)
    })?;

    let is_home = is_home_token(&token_id, cfg.namespace);
    let may = may_leave_or_open(is_live_core_asset(asset), false, &[], &[]);
    let owner_ok = read_owner(asset)
        .map(|o| o == *owner.key)
        .unwrap_or(false);
    let plan = plan_send(uri.clone(), token_id, is_home, may, owner_ok).map_err(into_program_error)?;

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
    solana_program::program::set_return_data(&message);
    msg!(
        "kar-gateway Send ok dst_eid={} uri_len={} msg_len={}",
        dst_eid,
        plan.uri.len(),
        message.len()
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

    if !authority.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, gateway_config)?;
    if authority.key.to_bytes() != cfg.authority {
        return Err(ProgramError::IllegalOwner);
    }
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
