//! Money-harness — local-validator proof of D-01 reachability-before-attempt.
//! Not a commercial mode.

use solana_program::entrypoint;

pub mod ix;
pub use ix::process_instruction;

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);
