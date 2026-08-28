//! ONFT721 message codec — byte-identical with `@layerzerolabs/onft-evm` ONFT721MsgCodec.
//!
//! Layout:
//! - sendTo:   [0, 32)
//! - tokenId:  [32, 64)
//! - compose:  [64, …)  iff length > 64
//!
//! Compose payload after encode is `composeFrom (32) || abi.encode(string uri)`.
//! Receiver skips exactly 32 sender bytes before ABI-decoding the string.

use thiserror::Error;

pub const SEND_TO_OFFSET: usize = 32;
pub const TOKEN_ID_OFFSET: usize = 64;
pub const SENDER_BYTES: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum CodecError {
    #[error("message too short")]
    TooShort,
    #[error("compose required")]
    ComposeRequired,
    #[error("compose undecodable")]
    ComposeUndecodable,
    #[error("invalid abi string")]
    InvalidAbiString,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OnftMessage {
    pub send_to: [u8; 32],
    pub token_id: [u8; 32],
    /// Full compose region including the 32-byte composeFrom prefix, if composed.
    pub compose: Option<Vec<u8>>,
}

impl OnftMessage {
    pub fn is_composed(&self) -> bool {
        self.compose.is_some()
    }

    /// URI string from compose, skipping composeFrom. Fail-closed if absent/undecodable
    /// (SVM D-16). Empty string after a valid ABI encode of "" is Ok(Some("")).
    pub fn uri_fail_closed(&self) -> Result<String, CodecError> {
        let Some(compose) = &self.compose else {
            return Err(CodecError::ComposeRequired);
        };
        if compose.len() <= SENDER_BYTES {
            return Err(CodecError::ComposeRequired);
        }
        // D-16: undecodable compose is a named protocol error, not a codec detail.
        decode_abi_string(&compose[SENDER_BYTES..]).map_err(|_| CodecError::ComposeUndecodable)
    }
}

/// Encode like ONFT721MsgCodec.encode(sendTo, tokenId, composeMsg).
/// `compose_msg` is the inner payload (typically ABI-encoded URI) — without composeFrom.
/// When `compose_msg` is Some, the wire message is composed (length > 64).
pub fn encode(
    send_to: [u8; 32],
    token_id: [u8; 32],
    compose_msg: Option<&[u8]>,
) -> (Vec<u8>, bool) {
    let mut out = Vec::with_capacity(64 + compose_msg.map(|c| 32 + c.len()).unwrap_or(0));
    out.extend_from_slice(&send_to);
    out.extend_from_slice(&token_id);
    let has_compose = if let Some(inner) = compose_msg {
        // composeFrom is written by the ONFT send path (msg.sender on EVM); local
        // encoders use a 32-byte zero placeholder matching receiver skip length.
        out.extend_from_slice(&[0u8; SENDER_BYTES]);
        out.extend_from_slice(inner);
        true
    } else {
        false
    };
    (out, has_compose)
}

pub fn decode(message: &[u8]) -> Result<OnftMessage, CodecError> {
    if message.len() < TOKEN_ID_OFFSET {
        return Err(CodecError::TooShort);
    }
    let mut send_to = [0u8; 32];
    let mut token_id = [0u8; 32];
    send_to.copy_from_slice(&message[0..SEND_TO_OFFSET]);
    token_id.copy_from_slice(&message[SEND_TO_OFFSET..TOKEN_ID_OFFSET]);
    let compose = if message.len() > TOKEN_ID_OFFSET {
        Some(message[TOKEN_ID_OFFSET..].to_vec())
    } else {
        None
    };
    Ok(OnftMessage {
        send_to,
        token_id,
        compose,
    })
}

/// Solidity `abi.encode(string)` — offset(32) + length(32) + data padded to 32.
pub fn abi_encode_string(s: &str) -> Vec<u8> {
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    // offset to string data = 32
    out.extend_from_slice(&{
        let mut w = [0u8; 32];
        w[31] = 32;
        w
    });
    // length
    let mut len_word = [0u8; 32];
    let len = bytes.len() as u64;
    len_word[24..32].copy_from_slice(&len.to_be_bytes());
    out.extend_from_slice(&len_word);
    // data + right padding
    out.extend_from_slice(bytes);
    let pad = (32 - (bytes.len() % 32)) % 32;
    out.extend(std::iter::repeat(0u8).take(pad));
    out
}

pub fn decode_abi_string(data: &[u8]) -> Result<String, CodecError> {
    if data.len() < 64 {
        return Err(CodecError::InvalidAbiString);
    }
    let offset = u64_be(&data[0..32]) as usize;
    if offset + 32 > data.len() {
        return Err(CodecError::InvalidAbiString);
    }
    let len = u64_be(&data[offset..offset + 32]) as usize;
    let start = offset + 32;
    let end = start.checked_add(len).ok_or(CodecError::InvalidAbiString)?;
    if end > data.len() {
        return Err(CodecError::InvalidAbiString);
    }
    String::from_utf8(data[start..end].to_vec()).map_err(|_| CodecError::InvalidAbiString)
}

fn u64_be(word: &[u8]) -> u64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&word[24..32]);
    u64::from_be_bytes(buf)
}

/// Left-pad a 20-byte EVM address into a 32-byte sendTo key.
pub fn evm_address_to_send_to(addr20: &[u8; 20]) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[12..32].copy_from_slice(addr20);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// `token_id = (namespace << 128) | local_seq` as 32-byte BE (product shape).
    fn token_id_from_parts(namespace: u128, local_seq: u128) -> [u8; 32] {
        let mut out = [0u8; 32];
        out[0..16].copy_from_slice(&namespace.to_be_bytes());
        out[16..32].copy_from_slice(&local_seq.to_be_bytes());
        out
    }

    fn fixtures_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures")
    }

    fn load_fixture(name: &str) -> Vec<u8> {
        let path = fixtures_dir().join(format!("{name}.hex"));
        let hex = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        let cleaned: String = hex.chars().filter(|c| !c.is_whitespace()).collect();
        (0..cleaned.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&cleaned[i..i + 2], 16).expect("hex"))
            .collect()
    }

    const TYPICAL_URI: &str = "ar://typical-pointer";

    #[test]
    fn typical_ar_84532_matches_fixture() {
        let send_to = [0xABu8; 32];
        let token_id = token_id_from_parts(84532, 1);
        let (msg, has) = encode(send_to, token_id, Some(&abi_encode_string(TYPICAL_URI)));
        assert!(has);
        assert_eq!(msg, load_fixture("typical_ar_84532"));
        let decoded = decode(&msg).unwrap();
        assert_eq!(decoded.send_to, send_to);
        assert_eq!(decoded.token_id, token_id);
        assert_eq!(decoded.uri_fail_closed().unwrap(), TYPICAL_URI);
    }

    #[test]
    fn ceiling_731_solana_ns_matches_fixture() {
        let uri = format!("ar://{}", "x".repeat(731 - 5));
        assert_eq!(uri.len(), 731);
        let mut addr = [0u8; 20];
        addr.fill(0x11);
        let send_to = evm_address_to_send_to(&addr);
        let token_id = token_id_from_parts(2_000_040_168, 7);
        let (msg, _) = encode(send_to, token_id, Some(&abi_encode_string(&uri)));
        assert_eq!(msg, load_fixture("ceiling_731_solana_ns"));
        assert_eq!(decode(&msg).unwrap().uri_fail_closed().unwrap(), uri);
    }

    #[test]
    fn sendto_full32_sol_ns_matches_fixture() {
        let send_to = [0xABu8; 32];
        assert_ne!(send_to[0], 0);
        let token_id = token_id_from_parts(2_000_040_168, 7);
        let (msg, _) = encode(send_to, token_id, Some(&abi_encode_string(TYPICAL_URI)));
        assert_eq!(msg, load_fixture("sendto_full32_sol_ns"));
        let decoded = decode(&msg).unwrap();
        assert_eq!(decoded.send_to, send_to);
        assert_eq!(decoded.token_id, token_id);
    }

    #[test]
    fn sendto_evm_padded_84532_matches_fixture() {
        let mut addr = [0u8; 20];
        addr.fill(0x11);
        let send_to = evm_address_to_send_to(&addr);
        assert_eq!(&send_to[0..12], &[0u8; 12]);
        let token_id = token_id_from_parts(84532, 1);
        let (msg, _) = encode(send_to, token_id, Some(&abi_encode_string(TYPICAL_URI)));
        assert_eq!(msg, load_fixture("sendto_evm_padded_84532"));
        assert_eq!(decode(&msg).unwrap().send_to, send_to);
    }

    #[test]
    fn token_id_namespaces_84532_and_solana() {
        let a = token_id_from_parts(84532, 1);
        let b = token_id_from_parts(2_000_040_168, 7);
        let mut ns_a = [0u8; 16];
        ns_a.copy_from_slice(&a[0..16]);
        let mut ns_b = [0u8; 16];
        ns_b.copy_from_slice(&b[0..16]);
        assert_eq!(u128::from_be_bytes(ns_a), 84532);
        assert_eq!(u128::from_be_bytes(ns_b), 2_000_040_168);
    }

    #[test]
    fn compose_extension_31_32_compose_required() {
        for len in [31usize, 32] {
            let fixture = load_fixture(&format!("compose_ext_{len}"));
            assert_eq!(fixture.len(), 64 + len);
            let decoded = decode(&fixture).unwrap();
            assert!(decoded.is_composed());
            assert_eq!(decoded.compose.as_ref().unwrap().len(), len);
            assert!(matches!(
                decoded.uri_fail_closed(),
                Err(CodecError::ComposeRequired)
            ));
        }
    }

    #[test]
    fn compose_extension_33_compose_undecodable() {
        let fixture = load_fixture("compose_ext_33");
        assert_eq!(fixture.len(), 64 + 33);
        let decoded = decode(&fixture).unwrap();
        assert_eq!(decoded.compose.as_ref().unwrap().len(), 33);
        assert!(matches!(
            decoded.uri_fail_closed(),
            Err(CodecError::ComposeUndecodable)
        ));
    }

    #[test]
    fn no_compose_compose_required_matches_fixture() {
        let send_to = [0xABu8; 32];
        let token_id = token_id_from_parts(84532, 1);
        let (msg, has) = encode(send_to, token_id, None);
        assert!(!has);
        assert_eq!(msg.len(), 64);
        assert_eq!(msg, load_fixture("no_compose"));
        assert!(matches!(
            decode(&msg).unwrap().uri_fail_closed(),
            Err(CodecError::ComposeRequired)
        ));
    }

    #[test]
    fn corrupted_compose_undecodable_matches_fixture() {
        let fixture = load_fixture("corrupted_compose");
        assert!(matches!(
            decode(&fixture).unwrap().uri_fail_closed(),
            Err(CodecError::ComposeUndecodable)
        ));
    }

    #[test]
    fn left_pad_evm() {
        let mut addr = [0u8; 20];
        addr[19] = 0x42;
        let send_to = evm_address_to_send_to(&addr);
        assert_eq!(&send_to[0..12], &[0u8; 12]);
        assert_eq!(send_to[31], 0x42);
    }
}
