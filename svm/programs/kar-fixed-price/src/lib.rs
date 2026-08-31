//! Kar FixedPrice (SVM) — asset-denominated selling mode.
//!
//! Fiat denomination is refused by name (`FiatDenominationRefused`). No price-account
//! / oracle / feed surface (S6 #3b). Shared automaton + money crates own phase/split/payout.
//! Custody via ownership-move (D-25 harness path).

use solana_program::entrypoint;

pub mod ix;
pub use ix::process_instruction;

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);
