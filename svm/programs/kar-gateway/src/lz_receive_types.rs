//! Normative LzReceive account indices for the stand / executor.
//!
//! Order is stable: clear accounts first, then passport CPI accounts.
//! Built by [`crate::lz_receive_types::lz_receive_types`].

use solana_program::pubkey::Pubkey;

use crate::config::GatewayConfig;
use crate::seeds::{config_pda, freeze_pda};

/// Account roles in the LzReceive instruction (index = position).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LzReceiveAccounts {
    pub gateway_config: usize,
    pub payer: usize,
    pub endpoint_program: usize,
    pub endpoint_config: usize,
    pub clear_receipt: usize,
    pub system_program: usize,
    pub passport_program: usize,
    pub passport_config: usize,
    pub asset: usize,
    pub state: usize,
    pub freeze_authority: usize,
    pub core_program: usize,
    pub to: usize,
}

pub const LZ_RECEIVE_ACCOUNTS: LzReceiveAccounts = LzReceiveAccounts {
    gateway_config: 0,
    payer: 1,
    endpoint_program: 2,
    endpoint_config: 3,
    clear_receipt: 4,
    system_program: 5,
    passport_program: 6,
    passport_config: 7,
    asset: 8,
    state: 9,
    freeze_authority: 10,
    core_program: 11,
    to: 12,
};

pub const LZ_RECEIVE_ACCOUNT_COUNT: usize = 13;

/// Deterministic pubkeys the executor must pass (plus payer/system which are runtime).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LzReceiveAccountList {
    pub gateway_config: Pubkey,
    pub endpoint_program: Pubkey,
    pub endpoint_config: Pubkey,
    pub clear_receipt: Pubkey,
    pub passport_program: Pubkey,
    pub passport_config: Pubkey,
    pub asset: Pubkey,
    pub state: Pubkey,
    pub freeze_authority: Pubkey,
    pub core_program: Pubkey,
    pub to: Pubkey,
    pub token_id: [u8; 32],
    pub src_eid: u32,
    pub sender: [u8; 32],
    pub nonce: u64,
}

/// Build the receive account list from message + config.
/// `src_eid` / `sender` / `nonce` come from the LayerZero Origin (passed by the caller).
pub fn lz_receive_types(
    gateway_program_id: &Pubkey,
    config: &GatewayConfig,
    message: &[u8],
    src_eid: u32,
    sender: [u8; 32],
    nonce: u64,
) -> Result<LzReceiveAccountList, kargain_errors::KargainError> {
    let decoded = kargain_onft_codec::decode(message)
        .map_err(|_| kargain_errors::KargainError::ComposeUndecodable)?;
    let passport = Pubkey::new_from_array(config.passport_program);
    let endpoint = Pubkey::new_from_array(config.endpoint_program);
    let (gateway_config, _) = config_pda(gateway_program_id);
    let (freeze, _) = freeze_pda(gateway_program_id);
    let (asset, _) = kar_passport::seeds::asset_pda(&passport, &decoded.token_id);
    let (state, _) = kar_passport::seeds::state_pda(&passport, &decoded.token_id);
    let (passport_config, _) = kar_passport::seeds::config_pda(&passport);
    let (endpoint_config, _) = mock_endpoint::config_pda(&endpoint);
    let (clear_receipt, _) = mock_endpoint::clear_pda(&endpoint, src_eid, &sender, nonce);
    Ok(LzReceiveAccountList {
        gateway_config,
        endpoint_program: endpoint,
        endpoint_config,
        clear_receipt,
        passport_program: passport,
        passport_config,
        asset,
        state,
        freeze_authority: freeze,
        core_program: mpl_core::ID,
        to: Pubkey::new_from_array(decoded.send_to),
        token_id: decoded.token_id,
        src_eid,
        sender,
        nonce,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::GATEWAY_CONFIG_DISCRIMINATOR;
    use kargain_onft_codec::{abi_encode_string, encode};
    use kar_passport::state::token_id_from_parts;

    #[test]
    fn indices_stable() {
        assert_eq!(LZ_RECEIVE_ACCOUNTS.clear_receipt, 4);
        assert_eq!(LZ_RECEIVE_ACCOUNTS.asset, 8);
        assert_eq!(LZ_RECEIVE_ACCOUNT_COUNT, 13);
    }

    #[test]
    fn deterministic_from_token_id() {
        let gateway = Pubkey::new_unique();
        let passport = Pubkey::new_unique();
        let endpoint = Pubkey::new_unique();
        let tid = token_id_from_parts(84532, 42);
        let composed = abi_encode_string("ar://t");
        let (msg, _) = encode([0x11; 32], tid, Some(&composed));
        let cfg = GatewayConfig {
            discriminator: GATEWAY_CONFIG_DISCRIMINATOR,
            authority: [0u8; 32],
            local_eid: 40168,
            endpoint_program: endpoint.to_bytes(),
            passport_program: passport.to_bytes(),
            namespace: 2_000_040_168,
            bump: 255,
            freeze_bump: 254,
        };
        let sender = [0xABu8; 32];
        let a = lz_receive_types(&gateway, &cfg, &msg, 40245, sender, 7).unwrap();
        let b = lz_receive_types(&gateway, &cfg, &msg, 40245, sender, 7).unwrap();
        assert_eq!(a, b);
        let (expected_asset, _) = kar_passport::seeds::asset_pda(&passport, &tid);
        assert_eq!(a.asset, expected_asset);
        assert_eq!(a.token_id, tid);
        let (expected_clear, _) = mock_endpoint::clear_pda(&endpoint, 40245, &sender, 7);
        assert_eq!(a.clear_receipt, expected_clear);
    }
}
