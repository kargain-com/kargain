//! KarProPass (SVM) — soulbound Core credential.
//!
//! Projection of stake state: mint on join CPI, close via separate instruction.
//! Leave never depends on burn. PermanentFreeze authority = freeze PDA (П-3).

pub mod account;
pub mod core_asset;
pub mod entrypoint;
pub mod instruction;
pub mod seeds;
pub mod state;

pub use entrypoint::process_instruction;

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);
