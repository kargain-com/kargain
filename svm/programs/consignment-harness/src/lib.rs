//! Consignment-harness — local-validator proof of shared automaton (S6 #2).
//! Not a commercial mode.

use solana_program::entrypoint;

pub mod ix;
pub use ix::process_instruction;

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);
