//! Normative LzReceive account indices — mock stand (13) and production EndpointV2 (18).
//!
//! Layout is selected from [`GatewayConfig::endpoint_program`]:
//! - production EndpointV2 → M2 list (RESULTS.md S4a-1)
//! - otherwise → mock stand list (preserved for `--live-both`)

use solana_program::pubkey::Pubkey;

use crate::config::GatewayConfig;
use crate::endpoint_v2::{
    is_production_endpoint, production_clear_accounts, ProductionClearAccounts,
};
use crate::seeds::{config_pda, freeze_pda};

/// Mock stand indices (clear accounts first, then passport CPI).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MockLzReceiveAccounts {
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

pub const MOCK_LZ_RECEIVE_ACCOUNTS: MockLzReceiveAccounts = MockLzReceiveAccounts {
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

pub const MOCK_LZ_RECEIVE_ACCOUNT_COUNT: usize = 13;

/// Production foreign-mint / unlock list (RESULTS.md M2) — payer first, clear trailing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProductionLzReceiveAccounts {
    pub payer: usize,
    pub gateway_config: usize,
    pub system_program: usize,
    pub passport_program: usize,
    pub passport_config: usize,
    pub asset: usize,
    pub state: usize,
    pub freeze_authority: usize,
    pub core_program: usize,
    pub to: usize,
    /// Clear metas occupy 10..18 (8 accounts).
    pub clear_endpoint_program: usize,
    pub clear_receiver: usize,
    pub clear_oapp_registry: usize,
    pub clear_nonce: usize,
    pub clear_payload_hash: usize,
    pub clear_endpoint_settings: usize,
    pub clear_event_authority: usize,
    pub clear_endpoint_program_event: usize,
}

pub const PRODUCTION_LZ_RECEIVE_ACCOUNTS: ProductionLzReceiveAccounts =
    ProductionLzReceiveAccounts {
        payer: 0,
        gateway_config: 1,
        system_program: 2,
        passport_program: 3,
        passport_config: 4,
        asset: 5,
        state: 6,
        freeze_authority: 7,
        core_program: 8,
        to: 9,
        clear_endpoint_program: 10,
        clear_receiver: 11,
        clear_oapp_registry: 12,
        clear_nonce: 13,
        clear_payload_hash: 14,
        clear_endpoint_settings: 15,
        clear_event_authority: 16,
        clear_endpoint_program_event: 17,
    };

pub const PRODUCTION_LZ_RECEIVE_ACCOUNT_COUNT: usize = 18;

/// Backward-compatible aliases for the mock stand path (docs + existing imports).
pub type LzReceiveAccounts = MockLzReceiveAccounts;
pub const LZ_RECEIVE_ACCOUNTS: MockLzReceiveAccounts = MOCK_LZ_RECEIVE_ACCOUNTS;
pub const LZ_RECEIVE_ACCOUNT_COUNT: usize = MOCK_LZ_RECEIVE_ACCOUNT_COUNT;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MockLzReceiveAccountList {
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProductionLzReceiveAccountList {
    pub gateway_config: Pubkey,
    pub endpoint_program: Pubkey,
    pub passport_program: Pubkey,
    pub passport_config: Pubkey,
    pub asset: Pubkey,
    pub state: Pubkey,
    pub freeze_authority: Pubkey,
    pub core_program: Pubkey,
    pub to: Pubkey,
    pub clear: ProductionClearAccounts,
    pub token_id: [u8; 32],
    pub src_eid: u32,
    pub sender: [u8; 32],
    pub nonce: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LzReceiveAccountList {
    Mock(MockLzReceiveAccountList),
    Production(ProductionLzReceiveAccountList),
}

/// Build the receive account list from message + config.
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
    let to = Pubkey::new_from_array(decoded.send_to);

    if is_production_endpoint(&endpoint) {
        let clear = production_clear_accounts(&endpoint, &gateway_config, src_eid, &sender, nonce);
        Ok(LzReceiveAccountList::Production(ProductionLzReceiveAccountList {
            gateway_config,
            endpoint_program: endpoint,
            passport_program: passport,
            passport_config,
            asset,
            state,
            freeze_authority: freeze,
            core_program: mpl_core::ID,
            to,
            clear,
            token_id: decoded.token_id,
            src_eid,
            sender,
            nonce,
        }))
    } else {
        let (endpoint_config, _) = mock_endpoint::config_pda(&endpoint);
        let (clear_receipt, _) = mock_endpoint::clear_pda(&endpoint, src_eid, &sender, nonce);
        Ok(LzReceiveAccountList::Mock(MockLzReceiveAccountList {
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
            to,
            token_id: decoded.token_id,
            src_eid,
            sender,
            nonce,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::GATEWAY_CONFIG_DISCRIMINATOR;
    use crate::endpoint_v2::production_endpoint_v2;
    use kargain_onft_codec::{abi_encode_string, encode};
    use kar_passport::state::token_id_from_parts;

    fn sample_cfg(endpoint: Pubkey, passport: Pubkey) -> GatewayConfig {
        GatewayConfig {
            discriminator: GATEWAY_CONFIG_DISCRIMINATOR,
            authority: [0u8; 32],
            local_eid: 40168,
            endpoint_program: endpoint.to_bytes(),
            passport_program: passport.to_bytes(),
            namespace: 2_000_040_168,
            bump: 255,
            freeze_bump: 254,
        }
    }

    #[test]
    fn mock_indices_stable() {
        assert_eq!(MOCK_LZ_RECEIVE_ACCOUNTS.clear_receipt, 4);
        assert_eq!(MOCK_LZ_RECEIVE_ACCOUNTS.asset, 8);
        assert_eq!(MOCK_LZ_RECEIVE_ACCOUNT_COUNT, 13);
        assert_eq!(LZ_RECEIVE_ACCOUNT_COUNT, 13);
    }

    #[test]
    fn production_indices_pinned_to_m2() {
        let a = PRODUCTION_LZ_RECEIVE_ACCOUNTS;
        assert_eq!(a.payer, 0);
        assert_eq!(a.gateway_config, 1);
        assert_eq!(a.to, 9);
        assert_eq!(a.clear_endpoint_program, 10);
        assert_eq!(a.clear_receiver, 11);
        assert_eq!(a.clear_oapp_registry, 12);
        assert_eq!(a.clear_nonce, 13);
        assert_eq!(a.clear_payload_hash, 14);
        assert_eq!(a.clear_endpoint_settings, 15);
        assert_eq!(a.clear_event_authority, 16);
        assert_eq!(a.clear_endpoint_program_event, 17);
        assert_eq!(PRODUCTION_LZ_RECEIVE_ACCOUNT_COUNT, 18);
    }

    #[test]
    fn mock_deterministic_from_token_id() {
        let gateway = Pubkey::new_unique();
        let passport = Pubkey::new_unique();
        let endpoint = Pubkey::new_unique();
        let tid = token_id_from_parts(84532, 42);
        let composed = abi_encode_string("ar://t");
        let (msg, _) = encode([0x11; 32], tid, Some(&composed));
        let cfg = sample_cfg(endpoint, passport);
        let sender = [0xABu8; 32];
        let a = lz_receive_types(&gateway, &cfg, &msg, 40245, sender, 7).unwrap();
        let b = lz_receive_types(&gateway, &cfg, &msg, 40245, sender, 7).unwrap();
        assert_eq!(a, b);
        match a {
            LzReceiveAccountList::Mock(list) => {
                let (expected_asset, _) = kar_passport::seeds::asset_pda(&passport, &tid);
                assert_eq!(list.asset, expected_asset);
                let (expected_clear, _) = mock_endpoint::clear_pda(&endpoint, 40245, &sender, 7);
                assert_eq!(list.clear_receipt, expected_clear);
            }
            LzReceiveAccountList::Production(_) => panic!("expected mock layout"),
        }
    }

    #[test]
    fn production_layout_when_endpoint_is_real() {
        let gateway = Pubkey::new_unique();
        let passport = Pubkey::new_unique();
        let endpoint = production_endpoint_v2();
        let tid = token_id_from_parts(84532, 42);
        let composed = abi_encode_string("ar://t");
        let (msg, _) = encode([0x11; 32], tid, Some(&composed));
        let cfg = sample_cfg(endpoint, passport);
        let sender = [0xABu8; 32];
        match lz_receive_types(&gateway, &cfg, &msg, 40245, sender, 7).unwrap() {
            LzReceiveAccountList::Production(list) => {
                assert_eq!(list.endpoint_program, endpoint);
                assert_eq!(list.clear.endpoint_program, endpoint);
                assert_eq!(list.clear.receiver, list.gateway_config);
            }
            LzReceiveAccountList::Mock(_) => panic!("expected production layout"),
        }
    }
}
