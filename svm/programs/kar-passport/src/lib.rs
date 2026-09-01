//! KarPassport (SVM) — Metaplex Core asset + Kargain state PDA.
//!
//! NFT substrate: Metaplex Core. Asset PDA = `[ASSET_SEED, token_id]` under this
//! program. Permanent freeze authority = gateway freeze PDA (not this program).
//! Existence for mint/`TokenExists` = Core asset account; state PDA is never closed
//! (tombstone after foreign burn) — D-17.
//!
//! П-12: namespace, EID, endpoint, dispute_deposit, staking, gateway, forfeit live
//! in the config PDA — never compile-time.

pub mod account;
pub mod bridge;
pub mod challenge;
pub mod claims;
pub mod core_asset;
pub mod custody;
pub mod entrypoint;
pub mod instruction;
pub mod may;
pub mod records;
pub mod seeds;
pub mod state;
pub mod uri;
pub mod verify;

pub use entrypoint::process_instruction;

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);
