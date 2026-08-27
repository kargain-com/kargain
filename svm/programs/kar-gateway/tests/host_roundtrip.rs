//! Host-level both-direction scenario — no validator.
//! Stitches clear sequencing + receive fail-closed + passport bridge plans.

use kargain_onft_codec::{abi_encode_string, encode};
use kar_gateway::clear::{assert_clear_before_state, ReceivePhase};
use kar_gateway::send_receive::{plan_receive, ReceiveKind};
use kar_passport::bridge::{
    check_bridge_burn, check_bridge_mint, check_bridge_reset_on_unlock, check_set_custody_lock,
};
use kar_passport::state::{token_id_from_parts, Status};

const EVM_NS: u128 = 84532;
const SVM_NS: u128 = 2_000_040_168;

#[test]
fn host_round_trip_both_directions() {
    let token_id = token_id_from_parts(EVM_NS, 1);
    let uri = "ar://stand-host-rust";
    let composed = abi_encode_string(uri);
    let to_svm = [0x11u8; 32];
    let to_evm = [0x22u8; 32];

    // Leave home: lock
    check_set_custody_lock(true, &token_id, EVM_NS, true).unwrap();

    // Outbound message
    let (outbound, _) = encode(to_svm, token_id, Some(&composed));

    // SVM receive: clear then mint foreign UNVERIFIED
    assert_clear_before_state(&[ReceivePhase::Cleared, ReceivePhase::StateMutated]).unwrap();
    let (_msg, kind) = plan_receive(&outbound, SVM_NS).unwrap();
    match kind {
        ReceiveKind::MintForeign { uri: u, .. } => assert_eq!(u, uri),
        other => panic!("expected mint foreign, got {other:?}"),
    }
    let mint = check_bridge_mint(true, &token_id, SVM_NS, false, uri).unwrap();
    assert_eq!(mint.status, Status::Unverified);
    assert_eq!(mint.uri, uri);

    // Return: burn foreign
    check_bridge_burn(true, &token_id, SVM_NS, true).unwrap();
    let (ret, _) = encode(to_evm, token_id, Some(&composed));

    // EVM unlock: clear then reset; VerificationReset from VERIFIED only
    assert_clear_before_state(&[ReceivePhase::Cleared, ReceivePhase::StateMutated]).unwrap();
    let (_m2, kind2) = plan_receive(&ret, EVM_NS).unwrap();
    match kind2 {
        ReceiveKind::UnlockHome { uri: u, .. } => assert_eq!(u, uri),
        other => panic!("expected unlock, got {other:?}"),
    }
    let reset = check_bridge_reset_on_unlock(
        true,
        &token_id,
        EVM_NS,
        true,
        Status::Verified,
        uri,
    )
    .unwrap();
    assert!(reset.emit_verification_reset);
    assert!(reset.adopt_uri);
    assert!(reset.clear_custody_lock);

    let no_reset = check_bridge_reset_on_unlock(
        true,
        &token_id,
        EVM_NS,
        true,
        Status::Unverified,
        uri,
    )
    .unwrap();
    assert!(!no_reset.emit_verification_reset);
}

#[test]
fn host_receive_fail_closed_before_state() {
    let token_id = token_id_from_parts(EVM_NS, 9);
    let (bare, _) = encode([1u8; 32], token_id, None);
    assert!(plan_receive(&bare, SVM_NS).is_err());
    // Must not reach clear/state if decode fails — sequencing helper still requires clear when used.
    assert!(assert_clear_before_state(&[ReceivePhase::StateMutated]).is_err());
}
