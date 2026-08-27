//! Local-stand Endpoint mock — implements the **clear** account layout the gateway
//! CPI expects. Not a messaging router; the dumb relay pays `lz_receive` as fee payer.
//!
//! Clear accounts (normative for the stand):
//! 0. endpoint config PDA
//! 1. oapp / gateway program signer
//! 2. nonce / inbound clear receipt PDA (`[CLEAR_SEED, src_eid_le, sender, nonce]`)
//! 3. payer (signer)

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub const CONFIG_SEED: &[u8] = b"ep_config";
pub const CLEAR_SEED: &[u8] = b"ep_clear";
pub const CLEAR_RECEIPT_DISCRIMINATOR: [u8; 8] = *b"ep_clr\0\0";

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct EndpointConfig {
    pub discriminator: [u8; 8],
    pub authority: [u8; 32],
    pub bump: u8,
}

pub const ENDPOINT_CONFIG_DISCRIMINATOR: [u8; 8] = *b"ep_cfg\0\0";

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct ClearReceipt {
    pub discriminator: [u8; 8],
    pub src_eid: u32,
    pub sender: [u8; 32],
    pub nonce: u64,
    pub guid: [u8; 32],
    pub bump: u8,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub enum MockEndpointIx {
    Initialize,
    /// Mark inbound payload cleared (must precede gateway state mutation).
    Clear {
        src_eid: u32,
        sender: [u8; 32],
        nonce: u64,
        guid: [u8; 32],
    },
}

pub fn config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], program_id)
}

pub fn clear_pda(
    program_id: &Pubkey,
    src_eid: u32,
    sender: &[u8; 32],
    nonce: u64,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CLEAR_SEED,
            &src_eid.to_le_bytes(),
            sender,
            &nonce.to_le_bytes(),
        ],
        program_id,
    )
}

/// Account indices the gateway documents for CPI clear (stand contract).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClearAccountLayout {
    pub endpoint_config: usize,
    pub oapp: usize,
    pub clear_receipt: usize,
    pub payer: usize,
}

pub const CLEAR_ACCOUNT_LAYOUT: ClearAccountLayout = ClearAccountLayout {
    endpoint_config: 0,
    oapp: 1,
    clear_receipt: 2,
    payer: 3,
};

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let ix =
        MockEndpointIx::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
    match ix {
        MockEndpointIx::Initialize => initialize(program_id, accounts),
        MockEndpointIx::Clear {
            src_eid,
            sender,
            nonce,
            guid,
        } => clear(program_id, accounts, src_eid, sender, nonce, guid),
    }
}

fn initialize(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let config = next_account_info(iter)?;
    let authority = next_account_info(iter)?;
    let system = next_account_info(iter)?;
    let (expected, bump) = config_pda(program_id);
    if config.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let record = EndpointConfig {
        discriminator: ENDPOINT_CONFIG_DISCRIMINATOR,
        authority: authority.key.to_bytes(),
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
    msg!("mock-endpoint Initialize ok");
    Ok(())
}

fn clear(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    src_eid: u32,
    sender: [u8; 32],
    nonce: u64,
    guid: [u8; 32],
) -> ProgramResult {
    if accounts.len() < 4 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let config = &accounts[CLEAR_ACCOUNT_LAYOUT.endpoint_config];
    let _oapp = &accounts[CLEAR_ACCOUNT_LAYOUT.oapp];
    let receipt = &accounts[CLEAR_ACCOUNT_LAYOUT.clear_receipt];
    let payer = &accounts[CLEAR_ACCOUNT_LAYOUT.payer];
    let system = accounts.get(4);

    let (cfg_key, _) = config_pda(program_id);
    if config.key != &cfg_key {
        return Err(ProgramError::InvalidSeeds);
    }
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let (expected, bump) = clear_pda(program_id, src_eid, &sender, nonce);
    if receipt.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }

    let record = ClearReceipt {
        discriminator: CLEAR_RECEIPT_DISCRIMINATOR,
        src_eid,
        sender,
        nonce,
        guid,
        bump,
    };
    let encoded = borsh::to_vec(&record).map_err(|_| ProgramError::InvalidAccountData)?;

    if receipt.lamports() == 0 {
        let Some(system) = system else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        let lamports = Rent::get()?.minimum_balance(encoded.len());
        solana_program::program::invoke_signed(
            &system_instruction::create_account(
                payer.key,
                receipt.key,
                lamports,
                encoded.len() as u64,
                program_id,
            ),
            &[payer.clone(), receipt.clone(), system.clone()],
            &[&[
                CLEAR_SEED,
                &src_eid.to_le_bytes(),
                &sender,
                &nonce.to_le_bytes(),
                &[bump],
            ]],
        )?;
    }

    let mut data = receipt.try_borrow_mut_data()?;
    if data.len() < encoded.len() {
        return Err(ProgramError::AccountDataTooSmall);
    }
    data[..encoded.len()].copy_from_slice(&encoded);
    msg!("mock-endpoint Clear src_eid={} nonce={}", src_eid, nonce);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clear_layout_indices_stable() {
        assert_eq!(CLEAR_ACCOUNT_LAYOUT.endpoint_config, 0);
        assert_eq!(CLEAR_ACCOUNT_LAYOUT.oapp, 1);
        assert_eq!(CLEAR_ACCOUNT_LAYOUT.clear_receipt, 2);
        assert_eq!(CLEAR_ACCOUNT_LAYOUT.payer, 3);
    }

    #[test]
    fn clear_pda_deterministic() {
        let pid = Pubkey::new_unique();
        let sender = [0xABu8; 32];
        let (a, _) = clear_pda(&pid, 40245, &sender, 7);
        let (b, _) = clear_pda(&pid, 40245, &sender, 7);
        assert_eq!(a, b);
        let (c, _) = clear_pda(&pid, 40245, &sender, 8);
        assert_ne!(a, c);
    }
}
