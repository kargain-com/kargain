//! LayerZero Executor LzReceiveTypes **V2** (Anchor sighash instructions).
//!
//! Devnet Executor refuses V1-only OApps (`lz_receive_types_info` required).
//! Stand / host continue to use Borsh `GatewayIx` paths.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::set_return_data,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

use crate::account::into_program_error;
use crate::config::GatewayConfig;
use crate::lz_receive_types::{lz_receive_types, LzReceiveAccountList};
use crate::seeds::config_pda;

/// `sha256("global:lz_receive_types_info")[..8]`
pub const IX_LZ_RECEIVE_TYPES_INFO: [u8; 8] =
    [0x2b, 0x94, 0xd5, 0x5d, 0x65, 0x7f, 0x25, 0xaa];
/// `sha256("global:lz_receive_types_v2")[..8]`
pub const IX_LZ_RECEIVE_TYPES_V2: [u8; 8] =
    [0x6d, 0x9d, 0xc8, 0x8e, 0x8a, 0xdf, 0x9f, 0xa4];
/// `sha256("global:lz_receive")[..8]`
pub const IX_LZ_RECEIVE_ANCHOR: [u8; 8] =
    [0x08, 0xb3, 0x78, 0x6d, 0x21, 0x76, 0xbd, 0x50];

pub const LZ_RECEIVE_TYPES_SEED: &[u8] = b"LzReceiveTypes";
pub const LZ_RECEIVE_TYPES_VERSION: u8 = 2;
pub const EXECUTION_CONTEXT_VERSION_1: u8 = 1;

/// Anchor `LzReceiveParams` (after 8-byte discriminator).
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct LzReceiveParams {
    pub src_eid: u32,
    pub sender: [u8; 32],
    pub nonce: u64,
    pub guid: [u8; 32],
    pub message: Vec<u8>,
    pub caller_params: Vec<u8>,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub enum AddressLocator {
    Address(Pubkey),
    AltIndex(u8, u8),
    Payer,
    Signer(u8),
    Context,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct AccountMetaRef {
    pub pubkey: AddressLocator,
    pub is_writable: bool,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub enum PlanInstruction {
    LzReceive { accounts: Vec<AccountMetaRef> },
    Standard {
        program_id: Pubkey,
        accounts: Vec<AccountMetaRef>,
        data: Vec<u8>,
    },
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct LzReceiveTypesV2Accounts {
    pub accounts: Vec<Pubkey>,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct LzReceiveTypesV2Result {
    pub context_version: u8,
    pub alts: Vec<Pubkey>,
    pub instructions: Vec<PlanInstruction>,
}

pub fn lz_receive_types_pda(
    program_id: &Pubkey,
    oapp: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[LZ_RECEIVE_TYPES_SEED, oapp.as_ref()], program_id)
}

pub fn try_dispatch_anchor_ix(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
    lz_receive_handler: impl FnOnce(
        &Pubkey,
        &[AccountInfo],
        u32,
        [u8; 32],
        u64,
        [u8; 32],
        Vec<u8>,
    ) -> ProgramResult,
) -> Option<ProgramResult> {
    if data.len() < 8 {
        return None;
    }
    let disc: [u8; 8] = data[..8].try_into().ok()?;
    let params_bytes = &data[8..];
    if disc == IX_LZ_RECEIVE_TYPES_INFO {
        return Some(handle_types_info(program_id, accounts, params_bytes));
    }
    if disc == IX_LZ_RECEIVE_TYPES_V2 {
        return Some(handle_types_v2(program_id, accounts, params_bytes));
    }
    if disc == IX_LZ_RECEIVE_ANCHOR {
        return Some(match LzReceiveParams::try_from_slice(params_bytes) {
            Ok(p) => lz_receive_handler(
                program_id,
                accounts,
                p.src_eid,
                p.sender,
                p.nonce,
                p.guid,
                p.message,
            ),
            Err(_) => Err(ProgramError::InvalidInstructionData),
        });
    }
    None
}

fn handle_types_info(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _params_bytes: &[u8],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let oapp = next_account_info(iter)?;
    let types_pda = next_account_info(iter)?;
    let (expected_cfg, _) = config_pda(program_id);
    if oapp.key != &expected_cfg {
        return Err(ProgramError::InvalidSeeds);
    }
    let (expected_types, _) = lz_receive_types_pda(program_id, oapp.key);
    if types_pda.key != &expected_types {
        return Err(ProgramError::InvalidSeeds);
    }
    // V2 versioned payload = LzReceiveTypesV2Accounts used to call lz_receive_types_v2.
    let payload = LzReceiveTypesV2Accounts {
        accounts: vec![*oapp.key],
    };
    let mut out = Vec::with_capacity(1 + 4 + 32);
    out.push(LZ_RECEIVE_TYPES_VERSION);
    out.extend_from_slice(
        &borsh::to_vec(&payload).map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    set_return_data(&out);
    msg!("lz_receive_types_info v2 ok");
    Ok(())
}

fn handle_types_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    params_bytes: &[u8],
) -> ProgramResult {
    let params = LzReceiveParams::try_from_slice(params_bytes)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let oapp = accounts
        .first()
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    let (expected_cfg, _) = config_pda(program_id);
    if oapp.key != &expected_cfg {
        return Err(ProgramError::InvalidSeeds);
    }
    let cfg = GatewayConfig::try_from_slice(&oapp.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;

    let list = lz_receive_types(
        program_id,
        &cfg,
        &params.message,
        params.src_eid,
        params.sender,
        params.nonce,
    )
    .map_err(into_program_error)?;

    let LzReceiveAccountList::Production(prod) = list else {
        return Err(ProgramError::InvalidArgument);
    };

    let clear = &prod.clear;
    let event_auth = clear.event_authority;

    // Match PRODUCTION_LZ_RECEIVE_ACCOUNTS order + writability.
    let metas = vec![
        AccountMetaRef {
            pubkey: AddressLocator::Payer,
            is_writable: true,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(prod.gateway_config),
            is_writable: true,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(solana_program::system_program::id()),
            is_writable: false,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(prod.passport_program),
            is_writable: false,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(prod.passport_config),
            is_writable: true,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(prod.asset),
            is_writable: true,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(prod.state),
            is_writable: true,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(prod.freeze_authority),
            is_writable: true,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(prod.core_program),
            is_writable: false,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(prod.to),
            is_writable: false,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(clear.endpoint_program),
            is_writable: false,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(clear.receiver),
            is_writable: true,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(clear.oapp_registry),
            is_writable: false,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(clear.nonce),
            is_writable: true,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(clear.payload_hash),
            is_writable: true,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(clear.endpoint_settings),
            is_writable: true,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(event_auth),
            is_writable: false,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(clear.endpoint_program),
            is_writable: false,
        },
        AccountMetaRef {
            pubkey: AddressLocator::Address(prod.peer_config),
            is_writable: false,
        },
    ];

    let result = LzReceiveTypesV2Result {
        context_version: EXECUTION_CONTEXT_VERSION_1,
        alts: vec![],
        instructions: vec![PlanInstruction::LzReceive { accounts: metas }],
    };
    let bytes =
        borsh::to_vec(&result).map_err(|_| ProgramError::InvalidInstructionData)?;
    set_return_data(&bytes);
    msg!(
        "lz_receive_types_v2 ok asset={} to={}",
        prod.asset,
        prod.to
    );
    Ok(())
}

/// Create `[LzReceiveTypes, gateway_config]` PDA (required by Executor info ix).
pub fn init_lz_receive_types_accounts(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let gateway_config = next_account_info(iter)?;
    let authority = next_account_info(iter)?;
    let types_pda = next_account_info(iter)?;
    let payer = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !authority.is_signer || !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = GatewayConfig::try_from_slice(&gateway_config.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if authority.key.to_bytes() != cfg.authority {
        return Err(ProgramError::InvalidArgument);
    }
    let (expected, bump) = lz_receive_types_pda(program_id, gateway_config.key);
    if types_pda.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if types_pda.lamports() > 0 {
        msg!("lz_receive_types PDA already exists");
        return Ok(());
    }
    let space = 8 + 32 + 32 + 1; // disc + store + alt + bump
    let rent = Rent::get()?.minimum_balance(space);
    let seeds: &[&[u8]] = &[
        LZ_RECEIVE_TYPES_SEED,
        gateway_config.key.as_ref(),
        &[bump],
    ];
    solana_program::program::invoke_signed(
        &system_instruction::create_account(
            payer.key,
            types_pda.key,
            rent,
            space as u64,
            program_id,
        ),
        &[payer.clone(), types_pda.clone(), system.clone()],
        &[seeds],
    )?;
    let mut data = types_pda.try_borrow_mut_data()?;
    data[..8].copy_from_slice(b"lzrcvtyp");
    data[8..40].copy_from_slice(gateway_config.key.as_ref());
    // alt = default (zeros already)
    data[72] = bump;
    msg!("init lz_receive_types PDA ok");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_program::hash::hash;

    #[test]
    fn discriminators_match_anchor_sighash() {
        let h = hash(b"global:lz_receive_types_info");
        assert_eq!(&h.to_bytes()[..8], &IX_LZ_RECEIVE_TYPES_INFO);
        let h2 = hash(b"global:lz_receive_types_v2");
        assert_eq!(&h2.to_bytes()[..8], &IX_LZ_RECEIVE_TYPES_V2);
        let h3 = hash(b"global:lz_receive");
        assert_eq!(&h3.to_bytes()[..8], &IX_LZ_RECEIVE_ANCHOR);
    }
}
