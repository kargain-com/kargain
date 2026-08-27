//! Account helpers / discriminators (shared with CPI stubs).

use solana_program::program_error::ProgramError;

use kargain_errors::KargainError;

pub fn into_program_error(e: KargainError) -> ProgramError {
    ProgramError::Custom(u32::from(e))
}
