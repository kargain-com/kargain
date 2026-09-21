//! Kar FixedPrice (SVM) — asset + fiat (P4 two-layer) selling mode.
//!
//! Fiat offered iff payment-token (or native) feed path is pinned at admit.
//! Purchase reads a price account via `kargain-price` (sole decode owner). Ascending
//! stays oracle-banned. Shared automaton + money crates own phase/split/payout.
//! Custody = Core passport TransferV1 (S8-E step 5); trust via passport May library.

use solana_program::entrypoint;

pub mod ix;
pub use ix::process_instruction;

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);
