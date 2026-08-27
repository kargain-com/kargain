use kargain_errors::KargainError;
use solana_program::program_error::ProgramError;

pub fn into_program_error(e: KargainError) -> ProgramError {
    ProgramError::Custom(u32::from(e))
}
