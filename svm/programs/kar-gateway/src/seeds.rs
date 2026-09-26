use solana_program::pubkey::Pubkey;

pub use kargain_config_pda::{config_pda, CONFIG_SEED};
pub use kargain_freeze_pda::{freeze_pda, FREEZE_SEED};
/// PeerConfig PDA seed — must match LZ OApp / Executor convention (`b"Peer"`).
pub const PEER_SEED: &[u8] = b"Peer";
