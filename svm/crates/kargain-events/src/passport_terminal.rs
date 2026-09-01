//! Passport verification terminal events — EVM-emitted, no Ponder handler (out of census).
//!
//! Still routed through the sole `emit_program_data` owner (not inline in programs).

use borsh::BorshSerialize;

use crate::emit_program_data;

pub fn emit_verification_lapsed(token_id: [u8; 32]) {
    let mut body = Vec::new();
    token_id.serialize(&mut body).expect("event field serialize");
    emit_program_data("VerificationLapsed", &body);
}

pub fn emit_verification_stood(token_id: [u8; 32]) {
    let mut body = Vec::new();
    token_id.serialize(&mut body).expect("event field serialize");
    emit_program_data("VerificationStood", &body);
}
