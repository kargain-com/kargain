//! Gateway config — П-12 (no compile-time EID / endpoint / lamports).

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey,
};

use crate::seeds::config_pda;

pub const GATEWAY_CONFIG_DISCRIMINATOR: [u8; 8] = *b"gw_cfg\0\0";

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct GatewayConfig {
    pub discriminator: [u8; 8],
    pub authority: [u8; 32],
    /// Local LayerZero EID from config.
    pub local_eid: u32,
    /// Endpoint program — mock on the stand, real Endpoint later.
    pub endpoint_program: [u8; 32],
    pub passport_program: [u8; 32],
    /// Local Kargain namespace (must match passport config).
    pub namespace: u128,
    pub bump: u8,
    pub freeze_bump: u8,
}

pub fn load_config(
    program_id: &Pubkey,
    config: &AccountInfo,
) -> Result<GatewayConfig, ProgramError> {
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

/// Load config PDA then sole admit (`kargain-config-authority`).
pub fn require_config_authority(
    program_id: &Pubkey,
    config: &AccountInfo,
    authority: &AccountInfo,
) -> Result<GatewayConfig, ProgramError> {
    let cfg = load_config(program_id, config)?;
    kargain_config_authority::admit_config_authority(
        authority.is_signer,
        &authority.key.to_bytes(),
        &cfg.authority,
    )?;
    Ok(cfg)
}
