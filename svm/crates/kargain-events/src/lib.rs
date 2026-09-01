//! Structured on-chain event surface — sole `sol_log_data` owner (SPEC §13.14 D-28).
//!
//! Operator diagnostics use [`ops_log!`] at call sites; they are **not** part of the
//! contract surface and must never be parsed by ingest.

use solana_program::log::sol_log_data;
use solana_program::msg;

pub mod generated;
pub mod passport_terminal;

pub use generated::REGISTRY;

/// Anchor-style event discriminator: first 8 bytes of `sha256("event:<Name>")`.
pub fn event_discriminator(name: &str) -> [u8; 8] {
    let hash = solana_program::hash::hash(format!("event:{name}").as_bytes());
    let bytes = hash.to_bytes();
    let mut out = [0u8; 8];
    out.copy_from_slice(&bytes[..8]);
    out
}

/// Sole structured emission entry point. `body` is borsh field order per Solidity ABI.
pub fn emit_program_data(event_name: &str, body: &[u8]) {
    let disc = event_discriminator(event_name);
    let mut data = Vec::with_capacity(8 + body.len());
    data.extend_from_slice(&disc);
    data.extend_from_slice(body);
    sol_log_data(&[&data]);
}

/// Operator-only diagnostic string — not ingest-facing.
#[macro_export]
macro_rules! ops_log {
    ($($arg:tt)*) => {
        $crate::ops_log_fmt(format_args!($($arg)*))
    };
}

/// Internal hook for [`ops_log!`].
#[inline]
pub fn ops_log_fmt(args: std::fmt::Arguments<'_>) {
    msg!("{}", args);
}

#[cfg(test)]
mod tests {
    use super::*;
    use borsh::BorshSerialize;

    #[test]
    fn discriminator_stable_for_passport_minted() {
        let d1 = event_discriminator("PassportMinted");
        let d2 = event_discriminator("PassportMinted");
        assert_eq!(d1, d2);
        assert_ne!(d1, event_discriminator("PassportVerified"));
    }

    #[test]
    fn registry_non_empty() {
        assert!(!REGISTRY.is_empty());
        assert_eq!(REGISTRY.len(), 78);
    }

    #[test]
    fn consignment_split_paid_encode_golden() {
        let token_id = [1u8; 32];
        let asset = [2u8; 32];
        let owner = [3u8; 32];
        let agent = [4u8; 32];
        let platform = [5u8; 32];
        let mut body = Vec::new();
        token_id.serialize(&mut body).unwrap();
        asset.serialize(&mut body).unwrap();
        owner.serialize(&mut body).unwrap();
        100u64.serialize(&mut body).unwrap();
        agent.serialize(&mut body).unwrap();
        200u64.serialize(&mut body).unwrap();
        platform.serialize(&mut body).unwrap();
        25u64.serialize(&mut body).unwrap();
        let disc = event_discriminator("ConsignmentSplitPaid");
        let mut wire = disc.to_vec();
        wire.extend_from_slice(&body);
        assert!(wire.len() <= 256, "heaviest commerce event wire stays compact");
    }
}
