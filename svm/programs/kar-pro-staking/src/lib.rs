//! KarProStaking (SVM) — native SOL stake; `active` is the sole verifier-status owner.
//!
//! Leave never CPI-burns the pass (pass is a projection). Close pass is a separate ix.

pub mod account;
pub mod entrypoint;
pub mod instruction;
pub mod seeds;
pub mod stake;
pub mod state;

pub use entrypoint::process_instruction;
pub use stake::{
    classify_stake_answer, is_active_verifier_record, prove_active_verifier, StakeAnswerView,
};
pub use seeds::stake_pda;
pub use state::{StakeAccount, STAKE_DISCRIMINATOR};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);
