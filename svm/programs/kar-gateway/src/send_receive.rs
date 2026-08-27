//! Send / receive pure gates — URI before debit; compose fail-closed (D-16).

use kargain_errors::KargainError;
use kargain_onft_codec::{decode, CodecError, OnftMessage};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SendPlan {
    pub uri: String,
    pub token_id: [u8; 32],
    pub is_home: bool,
}

/// Send check order: URI already read by caller → may(LeaveChain) → debit branch.
pub fn plan_send(
    uri: String,
    token_id: [u8; 32],
    is_home: bool,
    may_leave: Result<bool, KargainError>,
    representation_owner_ok: bool,
) -> Result<SendPlan, KargainError> {
    match may_leave {
        Ok(true) => {}
        Ok(false) => return Err(KargainError::LeaveChainRefused),
        Err(e) => return Err(e),
    }
    if !is_home && !representation_owner_ok {
        return Err(KargainError::NotRepresentationOwner);
    }
    Ok(SendPlan {
        uri,
        token_id,
        is_home,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReceiveKind {
    MintForeign { to: [u8; 32], uri: String },
    UnlockHome { to: [u8; 32], uri: String },
}

/// Decode message fail-closed, then classify home vs foreign.
/// Empty URI after valid `abi.encode("")` is Ok — unlock adopts only when len>0.
pub fn plan_receive(
    message: &[u8],
    local_namespace: u128,
) -> Result<(OnftMessage, ReceiveKind), KargainError> {
    let decoded = decode(message).map_err(codec_to_kargain)?;
    let uri = decoded.uri_fail_closed().map_err(codec_to_kargain)?;
    let is_home = kar_passport::state::is_home_token(&decoded.token_id, local_namespace);
    let kind = if is_home {
        ReceiveKind::UnlockHome {
            to: decoded.send_to,
            uri,
        }
    } else {
        ReceiveKind::MintForeign {
            to: decoded.send_to,
            uri,
        }
    };
    Ok((decoded, kind))
}

fn codec_to_kargain(e: CodecError) -> KargainError {
    match e {
        CodecError::ComposeRequired => KargainError::ComposeRequired,
        CodecError::ComposeUndecodable | CodecError::InvalidAbiString | CodecError::TooShort => {
            KargainError::ComposeUndecodable
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kargain_onft_codec::{abi_encode_string, encode};
    use kar_passport::state::token_id_from_parts;

    #[test]
    fn uri_captured_before_may_refusal() {
        // Caller supplies URI already; may refusal still returns LeaveChainRefused
        // without needing a second URI read (foreign burn must not clear mid-send).
        let err = plan_send(
            "ar://cached".into(),
            [1u8; 32],
            false,
            Ok(false),
            true,
        )
        .unwrap_err();
        assert_eq!(err, KargainError::LeaveChainRefused);
    }

    #[test]
    fn receive_without_compose_compose_required() {
        let (msg, _) = encode([9u8; 32], [8u8; 32], None);
        assert_eq!(
            plan_receive(&msg, 2_000_040_168).unwrap_err(),
            KargainError::ComposeRequired
        );
    }

    #[test]
    fn receive_corrupted_compose_undecodable() {
        let mut msg = vec![0u8; 64];
        msg.extend_from_slice(&[0u8; 32]);
        msg.extend_from_slice(&[0xff; 8]);
        assert_eq!(
            plan_receive(&msg, 1).unwrap_err(),
            KargainError::ComposeUndecodable
        );
    }

    #[test]
    fn receive_empty_uri_after_valid_encode_ok() {
        let composed = abi_encode_string("");
        let tid = token_id_from_parts(2_000_040_168, 3);
        let (msg, _) = encode([0xAB; 32], tid, Some(&composed));
        let (_m, kind) = plan_receive(&msg, 2_000_040_168).unwrap();
        match kind {
            ReceiveKind::UnlockHome { uri, .. } => assert!(uri.is_empty()),
            other => panic!("expected unlock, got {other:?}"),
        }
    }

    #[test]
    fn receive_foreign_mints() {
        let composed = abi_encode_string("ar://x");
        let tid = token_id_from_parts(84532, 1);
        let (msg, _) = encode([0xCD; 32], tid, Some(&composed));
        let (_m, kind) = plan_receive(&msg, 2_000_040_168).unwrap();
        match kind {
            ReceiveKind::MintForeign { uri, .. } => assert_eq!(uri, "ar://x"),
            other => panic!("expected mint, got {other:?}"),
        }
    }
}
