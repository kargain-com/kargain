//! KarPassport bridge gateway (SVM).
//!
//! - Send: URI **before** debit (SPEC §13.3a).
//! - Receive: Endpoint `clear` **before** any Kargain state change; fail-closed compose (D-16).
//! - `recover_locked_home`: three Solidity preconditions; no mint.
//! - `lz_receive_types`: deterministic from tokenId + config + Origin.
//! - Endpoint program id from config (П-12). **No** `fund_receive_rent` ix.
//!
//! LzReceive account order: mock stand [`lz_receive_types::MOCK_LZ_RECEIVE_ACCOUNTS`] (13)
//! or production EndpointV2 [`lz_receive_types::PRODUCTION_LZ_RECEIVE_ACCOUNTS`] (19 = M2 clear + PeerConfig),
//! selected from `GatewayConfig.endpoint_program`.

pub mod account;
pub mod clear;
pub mod config;
pub mod endpoint_v2;
pub mod entrypoint;
pub mod instruction;
pub mod lz_receive_types;
pub mod peer;
pub mod recover;
pub mod seeds;
pub mod send_receive;

pub use entrypoint::process_instruction;
pub use lz_receive_types::{
    lz_receive_types, LzReceiveAccountList, LzReceiveAccounts, MOCK_LZ_RECEIVE_ACCOUNT_COUNT,
    MOCK_LZ_RECEIVE_ACCOUNTS, PRODUCTION_LZ_RECEIVE_ACCOUNT_COUNT, PRODUCTION_LZ_RECEIVE_ACCOUNTS,
    LZ_RECEIVE_ACCOUNTS, LZ_RECEIVE_ACCOUNT_COUNT,
};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);
