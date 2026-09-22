//! Consignment-harness — local-validator proof of shared automaton (S6 #2).
//! Not a commercial mode.

use solana_program::entrypoint;

pub mod harness_asset;
pub mod ix;

pub use harness_asset::{
    asset_pda, is_escrow_approved, release_custody, require_can_open, take_custody, HarnessAsset,
    ASSET_DISCRIMINATOR, ASSET_SEED,
};
pub use ix::process_instruction;

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);
