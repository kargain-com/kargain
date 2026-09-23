use solana_program::pubkey::Pubkey;

pub use kargain_config_pda::{config_pda, CONFIG_SEED};
/// Permanent freeze authority PDA — program cannot ed25519-sign as itself (lab RESULTS).
pub const FREEZE_SEED: &[u8] = b"freeze";
/// PeerConfig PDA seed — must match LZ OApp / Executor convention (`b"Peer"`).
pub const PEER_SEED: &[u8] = b"Peer";

pub fn freeze_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[FREEZE_SEED], program_id)
}
