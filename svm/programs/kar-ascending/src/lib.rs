//! Kar Ascending (SVM) — asset-denominated auction mode.
//!
//! Asset denomination only: no price account / oracle / feed surface. The shared
//! automaton (`kargain-consignment-base`) owns phase, mandate and split; money and
//! reachability live in `kargain-claimable-payouts`; the settlement challenge is the
//! shared `kargain-bonded-challenge` state machine wired through `ChallengeHooks`.
//!
//! D-24: the shared open signature and `setPrice` are refused by name
//! (`AscendingOpenPath` / `TermsFixed`) — duration and protection are lot terms that
//! the shared signature cannot carry. Custody is an ownership move (D-25 harness path).

use solana_program::entrypoint;

pub mod ix;
pub use ix::process_instruction;

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);
