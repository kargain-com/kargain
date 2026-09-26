//! Pure MintPassport admission — one plan or a named refusal.
//!
//! Side effects (Core CPI, state write, config bump) stay in the processor.
//! Host tests assert against this owner so InvalidSeeds causes are distinguishable.

use kargain_config_pda::config_pda;
use kargain_errors::KargainError;
use solana_program::program_error::ProgramError;
use solana_program::pubkey::Pubkey;

use crate::account::into_program_error;
use crate::seeds::{asset_pda, state_pda};
use crate::state::{token_id_from_parts, PassportConfig};

/// Successful mint admission — values the processor uses for CPI and writes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MintAdmissionPlan {
    pub token_id: [u8; 32],
    pub next_token_id: [u8; 32],
    pub freeze: Pubkey,
    pub asset_bump: u8,
    pub state_bump: u8,
}

/// Named mint refusals. Three InvalidSeeds causes stay distinct here; the
/// processor maps them all to [`ProgramError::InvalidSeeds`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MintAdmissionError {
    MissingRequiredSignature,
    ZeroAddress,
    InvalidReceiver,
    TokenIdSpaceExhausted,
    BridgeGatewayUnbound,
    NotBridgeGateway,
    /// Gateway config account owner does not derive the bound config PDA.
    GatewayConfigNotDerived,
    /// Freeze authority key ≠ `freeze_pda(gateway_config.owner)`.
    ForeignFreeze,
    /// Asset account key ≠ `asset_pda(program_id, token_id)`.
    AssetMismatch,
}

impl From<MintAdmissionError> for ProgramError {
    fn from(e: MintAdmissionError) -> Self {
        match e {
            MintAdmissionError::MissingRequiredSignature => ProgramError::MissingRequiredSignature,
            MintAdmissionError::ZeroAddress => into_program_error(KargainError::ZeroAddress),
            MintAdmissionError::InvalidReceiver => {
                into_program_error(KargainError::InvalidReceiver)
            }
            MintAdmissionError::TokenIdSpaceExhausted => {
                into_program_error(KargainError::TokenIdSpaceExhausted)
            }
            MintAdmissionError::BridgeGatewayUnbound => {
                into_program_error(KargainError::BridgeGatewayUnbound)
            }
            MintAdmissionError::NotBridgeGateway => {
                into_program_error(KargainError::NotBridgeGateway)
            }
            MintAdmissionError::GatewayConfigNotDerived
            | MintAdmissionError::ForeignFreeze
            | MintAdmissionError::AssetMismatch => ProgramError::InvalidSeeds,
        }
    }
}

/// Sole freeze bind over keys (passport config + gateway config identity).
///
/// Used by [`admit_mint_passport`] and by bridge mint (via AccountInfo wrapper).
pub fn admit_bound_gateway_freeze(
    cfg: &PassportConfig,
    gateway_config_key: &Pubkey,
    gateway_config_owner: &Pubkey,
) -> Result<Pubkey, MintAdmissionError> {
    if cfg.bridge_gateway == [0u8; 32] {
        return Err(MintAdmissionError::BridgeGatewayUnbound);
    }
    if gateway_config_key.to_bytes() != cfg.bridge_gateway {
        return Err(MintAdmissionError::NotBridgeGateway);
    }
    let (expected_cfg, _) = config_pda(gateway_config_owner);
    if &expected_cfg != gateway_config_key {
        return Err(MintAdmissionError::GatewayConfigNotDerived);
    }
    let (freeze, _) = kargain_freeze_pda::freeze_pda(gateway_config_owner);
    Ok(freeze)
}

/// Freeze key must equal the bound-gateway freeze PDA.
pub fn admit_freeze_authority_key(
    expected_freeze: &Pubkey,
    freeze_authority: &Pubkey,
) -> Result<(), MintAdmissionError> {
    if freeze_authority != expected_freeze {
        return Err(MintAdmissionError::ForeignFreeze);
    }
    Ok(())
}

/// Pure MintPassport admission (order matches the processor before side effects).
///
/// 1. payer signer  
/// 2. owner ≠ default  
/// 3. owner ≠ bound gateway  
/// 4. token-id space  
/// 5. bound-gateway freeze  
/// 6. freeze key equals  
/// 7. asset PDA equals  
pub fn admit_mint_passport(
    program_id: &Pubkey,
    cfg: &PassportConfig,
    payer_is_signer: bool,
    owner: &Pubkey,
    freeze_authority: &Pubkey,
    gateway_config_key: &Pubkey,
    gateway_config_owner: &Pubkey,
    asset_key: &Pubkey,
) -> Result<MintAdmissionPlan, MintAdmissionError> {
    if !payer_is_signer {
        return Err(MintAdmissionError::MissingRequiredSignature);
    }
    if *owner == Pubkey::default() {
        return Err(MintAdmissionError::ZeroAddress);
    }
    if owner.to_bytes() == cfg.bridge_gateway {
        return Err(MintAdmissionError::InvalidReceiver);
    }
    let token_id = cfg.next_token_id;
    let seq = u128::from_be_bytes({
        let mut b = [0u8; 16];
        b.copy_from_slice(&token_id[16..32]);
        b
    });
    let next_seq = seq
        .checked_add(1)
        .ok_or(MintAdmissionError::TokenIdSpaceExhausted)?;
    let next_token_id = token_id_from_parts(cfg.namespace, next_seq);

    let freeze =
        admit_bound_gateway_freeze(cfg, gateway_config_key, gateway_config_owner)?;
    admit_freeze_authority_key(&freeze, freeze_authority)?;

    let (expected_asset, asset_bump) = asset_pda(program_id, &token_id);
    if asset_key != &expected_asset {
        return Err(MintAdmissionError::AssetMismatch);
    }
    let (_state_key, state_bump) = state_pda(program_id, &token_id);

    Ok(MintAdmissionPlan {
        token_id,
        next_token_id,
        freeze,
        asset_bump,
        state_bump,
    })
}
