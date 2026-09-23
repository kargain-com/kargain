//! Account-state layout census.
//!
//! Authority: Rust `BorshSerialize` of program account structs.
//! Committed artifact: `state.manifest.json`. Goldens are never produced by
//! the TypeScript decoder.
//!
//! Layout kinds (length fields are never a rent SPACE unless they happen to
//! equal a program `SPACE` constant):
//! - Fixed-padded (`PassportState`, `StakeAccount`): `golden_byte_length` is
//!   the padded golden (`SPACE`); `modelled_byte_length` is the borsh payload.
//! - Exact (`ChallengeAccount`, `EncumbranceAnswer`, `PassportBinding`):
//!   both lengths == Borsh payload == program SPACE; no pad.
//! - Variable sample / deliberately partial (`PassportConfig`): no program
//!   SPACE — `golden_byte_length` is this sample's byte length; modelled
//!   prefix stops at `remainder_unmodelled`.

use kargain_bonded_challenge::{ChallengeAccount, CHALLENGE_ACCOUNT_DISCRIMINATOR};
use kargain_consignment_base::{
    PassportBinding, PASSPORT_BINDING_DISCRIMINATOR,
};
use kargain_encumbrance::{
    EncumbranceAnswer, ENCUMBRANCE_ANSWER_DISCRIMINATOR,
};
use kar_passport::state::{
    EncumbranceSourceEntry, PassportConfig, PassportState, Status,
    PASSPORT_CONFIG_DISCRIMINATOR, PASSPORT_STATE_DISCRIMINATOR, PASSPORT_STATE_SPACE,
};
use kar_pro_staking::state::{
    StakeAccount, STAKE_ACCOUNT_SPACE, STAKE_DISCRIMINATOR,
};
use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::{
    field_bool, field_fixed, field_remainder_unmodelled, field_u128, field_u32, field_u64,
    field_u8, hex_of, FieldDecl,
};

pub const STATE_MANIFEST_REL_PATH: &str = "state.manifest.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateFieldDecl {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub len: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateLayoutEntry {
    pub id: String,
    pub program: String,
    /// Always `golden_hex.len() / 2`. Not a rent SPACE unless it equals a
    /// program `SPACE` constant (PassportConfig has none).
    pub golden_byte_length: usize,
    pub discriminator_hex: String,
    pub fields: Vec<StateFieldDecl>,
    pub sample: Map<String, Value>,
    /// Account bytes as hex (padded for fixed layouts; exact for Challenge /
    /// EncumbranceAnswer / PassportBinding; full Borsh sample for PassportConfig).
    pub golden_hex: String,
    /// Decoder cursor stop (borsh payload before pad, or modelled prefix).
    pub modelled_byte_length: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct StateManifest {
    pub version: u32,
    pub layouts: Vec<StateLayoutEntry>,
}

fn wrap_field(f: FieldDecl) -> StateFieldDecl {
    StateFieldDecl {
        name: f.name,
        ty: f.ty,
        len: f.len,
    }
}

/// Refuse layouts that place anything after `remainder_unmodelled`, or that
/// use the marker mid-list / more than once.
fn assert_remainder_marker_is_terminal(fields: &[StateFieldDecl], layout_id: &str) {
    let mut seen = false;
    for (i, f) in fields.iter().enumerate() {
        if f.ty == "remainder_unmodelled" {
            assert!(
                !seen,
                "{layout_id}: remainder_unmodelled must appear at most once"
            );
            seen = true;
            assert_eq!(
                i,
                fields.len() - 1,
                "{layout_id}: remainder_unmodelled must be last (got field after it)"
            );
        }
    }
}

fn passport_state_fields() -> Vec<StateFieldDecl> {
    vec![
        wrap_field(field_fixed("discriminator", 8)),
        wrap_field(field_fixed("token_id", 32)),
        // Status: borsh(use_discriminant = true) + repr(u8) → single u8 ordinal
        wrap_field(field_u8("status")),
        wrap_field(field_fixed("verifier", 32)),
        wrap_field(field_u64("verified_at")),
        wrap_field(field_bool("custody_locked")),
        wrap_field(field_bool("burned")),
        wrap_field(field_u32("record_count")),
        wrap_field(field_u8("bump")),
    ]
}

fn sample_passport_state() -> (PassportState, Map<String, Value>) {
    // Deterministic sample — not a live account. token_id = 0x22…, verifier = 0x33…
    let token_id = [0x22u8; 32];
    let verifier = [0x33u8; 32];
    let state = PassportState {
        discriminator: PASSPORT_STATE_DISCRIMINATOR,
        token_id,
        status: Status::Verified,
        verifier,
        verified_at: 1_700_000_000,
        custody_locked: false,
        burned: false,
        record_count: 7,
        bump: 255,
    };
    let mut sample = Map::new();
    sample.insert(
        "discriminator".into(),
        json!(hex_of(&PASSPORT_STATE_DISCRIMINATOR)),
    );
    sample.insert("token_id".into(), json!(hex_of(&token_id)));
    sample.insert("status".into(), json!(1u8)); // Verified
    sample.insert("verifier".into(), json!(hex_of(&verifier)));
    sample.insert("verified_at".into(), json!("1700000000"));
    sample.insert("custody_locked".into(), json!(false));
    sample.insert("burned".into(), json!(false));
    sample.insert("record_count".into(), json!(7u32));
    sample.insert("bump".into(), json!(255u8));
    (state, sample)
}

fn passport_state_layout() -> StateLayoutEntry {
    let (state, sample) = sample_passport_state();
    let payload = borsh::to_vec(&state).expect("borsh serialize PassportState");
    let payload_len = payload.len();
    assert!(
        payload_len < PASSPORT_STATE_SPACE,
        "PassportState borsh payload must be shorter than PASSPORT_STATE_SPACE (padding is load-bearing)"
    );
    let mut account = vec![0u8; PASSPORT_STATE_SPACE];
    account[..payload_len].copy_from_slice(&payload);
    StateLayoutEntry {
        id: "kar-passport/PassportState".into(),
        program: "kar-passport".into(),
        golden_byte_length: PASSPORT_STATE_SPACE,
        discriminator_hex: hex_of(&PASSPORT_STATE_DISCRIMINATOR),
        fields: passport_state_fields(),
        sample,
        golden_hex: hex_of(&account),
        modelled_byte_length: payload_len,
    }
}

fn stake_account_fields() -> Vec<StateFieldDecl> {
    vec![
        wrap_field(field_fixed("discriminator", 8)),
        wrap_field(field_fixed("wallet", 32)),
        wrap_field(field_u64("amount")),
        wrap_field(field_u64("staked_at")),
        wrap_field(field_bool("active")),
        wrap_field(field_u64("unlock_at")),
        wrap_field(field_u64("verification_fee")),
        wrap_field(field_u8("bump")),
    ]
}

fn sample_stake_account() -> (StakeAccount, Map<String, Value>) {
    // Deterministic sample — not a live account. wallet = 0x44…
    let wallet = [0x44u8; 32];
    let stake = StakeAccount {
        discriminator: STAKE_DISCRIMINATOR,
        wallet,
        amount: 500_000_000,
        staked_at: 1_700_000_000,
        active: true,
        unlock_at: 0,
        verification_fee: 1_000_000,
        bump: 254,
    };
    let mut sample = Map::new();
    sample.insert(
        "discriminator".into(),
        json!(hex_of(&STAKE_DISCRIMINATOR)),
    );
    sample.insert("wallet".into(), json!(hex_of(&wallet)));
    sample.insert("amount".into(), json!("500000000"));
    sample.insert("staked_at".into(), json!("1700000000"));
    sample.insert("active".into(), json!(true));
    sample.insert("unlock_at".into(), json!("0"));
    sample.insert("verification_fee".into(), json!("1000000"));
    sample.insert("bump".into(), json!(254u8));
    (stake, sample)
}

fn stake_account_layout() -> StateLayoutEntry {
    let (stake, sample) = sample_stake_account();
    let payload = borsh::to_vec(&stake).expect("borsh serialize StakeAccount");
    let payload_len = payload.len();
    assert!(
        payload_len < STAKE_ACCOUNT_SPACE,
        "StakeAccount borsh payload must be shorter than STAKE_ACCOUNT_SPACE (padding is load-bearing)"
    );
    let mut account = vec![0u8; STAKE_ACCOUNT_SPACE];
    account[..payload_len].copy_from_slice(&payload);
    StateLayoutEntry {
        id: "kar-pro-staking/StakeAccount".into(),
        program: "kar-pro-staking".into(),
        golden_byte_length: STAKE_ACCOUNT_SPACE,
        discriminator_hex: hex_of(&STAKE_DISCRIMINATOR),
        fields: stake_account_fields(),
        sample,
        golden_hex: hex_of(&account),
        modelled_byte_length: payload_len,
    }
}

fn challenge_account_fields() -> Vec<StateFieldDecl> {
    vec![
        wrap_field(field_fixed("discriminator", 8)),
        wrap_field(field_fixed("subject_id", 32)),
        wrap_field(field_u64("opened_at")),
        wrap_field(field_u64("window_duration")),
        wrap_field(field_fixed("challenger", 32)),
        wrap_field(field_u64("bond_amount")),
        wrap_field(field_u8("bump")),
    ]
}

fn sample_challenge_account() -> (ChallengeAccount, Map<String, Value>) {
    // Deterministic sample — subject_id = 0x55…, challenger = 0x66…
    let subject_id = [0x55u8; 32];
    let challenger = [0x66u8; 32];
    let account = ChallengeAccount {
        discriminator: CHALLENGE_ACCOUNT_DISCRIMINATOR,
        subject_id,
        opened_at: 1_700_000_000,
        window_duration: 1_209_600,
        challenger,
        bond_amount: 10_000_000,
        bump: 253,
    };
    let mut sample = Map::new();
    sample.insert(
        "discriminator".into(),
        json!(hex_of(&CHALLENGE_ACCOUNT_DISCRIMINATOR)),
    );
    sample.insert("subject_id".into(), json!(hex_of(&subject_id)));
    sample.insert("opened_at".into(), json!("1700000000"));
    sample.insert("window_duration".into(), json!("1209600"));
    sample.insert("challenger".into(), json!(hex_of(&challenger)));
    sample.insert("bond_amount".into(), json!("10000000"));
    sample.insert("bump".into(), json!(253u8));
    (account, sample)
}

fn challenge_account_layout() -> StateLayoutEntry {
    let (account, sample) = sample_challenge_account();
    let payload = borsh::to_vec(&account).expect("borsh serialize ChallengeAccount");
    let payload_len = payload.len();
    assert_eq!(
        payload_len,
        ChallengeAccount::SPACE,
        "ChallengeAccount borsh payload must equal SPACE (no padding)"
    );
    assert_eq!(payload_len, 97);
    StateLayoutEntry {
        id: "kargain-bonded-challenge/ChallengeAccount".into(),
        program: "kar-passport".into(),
        golden_byte_length: ChallengeAccount::SPACE,
        discriminator_hex: hex_of(&CHALLENGE_ACCOUNT_DISCRIMINATOR),
        fields: challenge_account_fields(),
        sample,
        golden_hex: hex_of(&payload),
        modelled_byte_length: payload_len,
    }
}

/// Modelled prefix through `forfeit_recipient`, then terminal remainder marker.
/// Does **not** declare encumbrance_sources / bump — those are the unmodelled
/// structured remainder (not zero padding).
fn passport_config_fields() -> Vec<StateFieldDecl> {
    let fields = vec![
        wrap_field(field_fixed("discriminator", 8)),
        wrap_field(field_fixed("authority", 32)),
        wrap_field(field_u128("namespace")),
        wrap_field(field_u32("local_eid")),
        wrap_field(field_fixed("endpoint_program", 32)),
        wrap_field(field_u64("dispute_deposit")),
        wrap_field(field_fixed("staking_program", 32)),
        wrap_field(field_fixed("bridge_gateway", 32)),
        wrap_field(field_fixed("forfeit_recipient", 32)),
        // Deliberately partial: Vec + bump exist on-chain but are not modelled.
        wrap_field(field_remainder_unmodelled()),
    ];
    assert_remainder_marker_is_terminal(&fields, "kar-passport/PassportConfig");
    fields
}

fn sample_passport_config() -> (PassportConfig, Map<String, Value>, usize) {
    // Deterministic sample with a **populated** encumbrance_sources so a
    // decoder that wrongly walks the tail cannot pass an empty-vec golden.
    let authority = [0x11u8; 32];
    let endpoint_program = [0x22u8; 32];
    let staking_program = [0x33u8; 32];
    let bridge_gateway = [0x44u8; 32];
    let forfeit_recipient = [0x55u8; 32];
    let next_token_id = [0x66u8; 32];
    let source_program = [0x77u8; 32];
    let config = PassportConfig {
        discriminator: PASSPORT_CONFIG_DISCRIMINATOR,
        authority,
        namespace: 2_000_040_168u128,
        local_eid: 40168,
        endpoint_program,
        dispute_deposit: 10_000_000,
        staking_program,
        bridge_gateway,
        forfeit_recipient,
        next_token_id,
        encumbrance_sources: vec![EncumbranceSourceEntry {
            program_id: source_program,
            seed_prefix: b"ans".to_vec(),
        }],
        bump: 252,
    };
    // Modelled prefix length = bytes through forfeit_recipient (before Vec).
    // 8+32+16+4+32+8+32+32+32 = 196
    const MODELLED_PREFIX_LEN: usize = 8 + 32 + 16 + 4 + 32 + 8 + 32 + 32 + 32;
    let mut sample = Map::new();
    sample.insert(
        "discriminator".into(),
        json!(hex_of(&PASSPORT_CONFIG_DISCRIMINATOR)),
    );
    sample.insert("authority".into(), json!(hex_of(&authority)));
    sample.insert("namespace".into(), json!("2000040168"));
    sample.insert("local_eid".into(), json!(40168u32));
    sample.insert("endpoint_program".into(), json!(hex_of(&endpoint_program)));
    sample.insert("dispute_deposit".into(), json!("10000000"));
    sample.insert("staking_program".into(), json!(hex_of(&staking_program)));
    sample.insert("bridge_gateway".into(), json!(hex_of(&bridge_gateway)));
    sample.insert(
        "forfeit_recipient".into(),
        json!(hex_of(&forfeit_recipient)),
    );
    (config, sample, MODELLED_PREFIX_LEN)
}

fn passport_config_layout() -> StateLayoutEntry {
    let (config, sample, modelled_prefix_len) = sample_passport_config();
    let payload = borsh::to_vec(&config).expect("borsh serialize PassportConfig");
    let golden_byte_length = payload.len();
    assert!(
        golden_byte_length > modelled_prefix_len,
        "PassportConfig sample must carry unmodelled tail (populated encumbrance_sources)"
    );
    // No PASSPORT_CONFIG_SPACE — golden_byte_length is this sample only.
    StateLayoutEntry {
        id: "kar-passport/PassportConfig".into(),
        program: "kar-passport".into(),
        golden_byte_length,
        discriminator_hex: hex_of(&PASSPORT_CONFIG_DISCRIMINATOR),
        fields: passport_config_fields(),
        sample,
        golden_hex: hex_of(&payload),
        // Cursor stops at remainder_unmodelled; modelled prefix is the payload.
        modelled_byte_length: modelled_prefix_len,
    }
}

fn encumbrance_answer_fields() -> Vec<StateFieldDecl> {
    vec![
        wrap_field(field_fixed("discriminator", 8)),
        wrap_field(field_fixed("token_id", 32)),
        wrap_field(field_u8("intent")),
        wrap_field(field_bool("allowed")),
        wrap_field(field_fixed("funder", 32)),
    ]
}

fn sample_encumbrance_answer() -> (EncumbranceAnswer, Map<String, Value>) {
    // Deterministic sample — create-time law: allowed=false. token_id = 0xaa…, funder = 0x88…
    let token_id = [0xaau8; 32];
    let funder = [0x88u8; 32];
    let answer = EncumbranceAnswer {
        discriminator: ENCUMBRANCE_ANSWER_DISCRIMINATOR,
        token_id,
        intent: 0,
        allowed: false,
        funder,
    };
    let mut sample = Map::new();
    sample.insert(
        "discriminator".into(),
        json!(hex_of(&ENCUMBRANCE_ANSWER_DISCRIMINATOR)),
    );
    sample.insert("token_id".into(), json!(hex_of(&token_id)));
    sample.insert("intent".into(), json!(0u8));
    sample.insert("allowed".into(), json!(false));
    sample.insert("funder".into(), json!(hex_of(&funder)));
    (answer, sample)
}

fn encumbrance_answer_layout() -> StateLayoutEntry {
    let (answer, sample) = sample_encumbrance_answer();
    let payload = borsh::to_vec(&answer).expect("borsh serialize EncumbranceAnswer");
    assert_eq!(
        payload.len(),
        EncumbranceAnswer::SPACE,
        "EncumbranceAnswer borsh payload must equal SPACE (no padding)"
    );
    assert_eq!(payload.len(), 74);
    StateLayoutEntry {
        id: "kargain-encumbrance/EncumbranceAnswer".into(),
        program: "kargain-encumbrance".into(),
        golden_byte_length: EncumbranceAnswer::SPACE,
        discriminator_hex: hex_of(&ENCUMBRANCE_ANSWER_DISCRIMINATOR),
        fields: encumbrance_answer_fields(),
        sample,
        golden_hex: hex_of(&payload),
        modelled_byte_length: EncumbranceAnswer::SPACE,
    }
}

fn passport_binding_fields() -> Vec<StateFieldDecl> {
    vec![
        wrap_field(field_fixed("discriminator", 8)),
        wrap_field(field_fixed("passport_program", 32)),
        wrap_field(field_u8("bump")),
    ]
}

fn sample_passport_binding() -> (PassportBinding, Map<String, Value>) {
    // Deterministic sample — passport_program = 0x99…
    let passport_program = [0x99u8; 32];
    let binding = PassportBinding {
        discriminator: PASSPORT_BINDING_DISCRIMINATOR,
        passport_program,
        bump: 255,
    };
    let mut sample = Map::new();
    sample.insert(
        "discriminator".into(),
        json!(hex_of(&PASSPORT_BINDING_DISCRIMINATOR)),
    );
    sample.insert(
        "passport_program".into(),
        json!(hex_of(&passport_program)),
    );
    sample.insert("bump".into(), json!(255u8));
    (binding, sample)
}

fn passport_binding_layout() -> StateLayoutEntry {
    let (binding, sample) = sample_passport_binding();
    let payload = borsh::to_vec(&binding).expect("borsh serialize PassportBinding");
    assert_eq!(
        payload.len(),
        PassportBinding::SPACE,
        "PassportBinding borsh payload must equal SPACE (no padding)"
    );
    assert_eq!(payload.len(), 41);
    StateLayoutEntry {
        id: "kargain-consignment-base/PassportBinding".into(),
        program: "kargain-consignment-base".into(),
        golden_byte_length: PassportBinding::SPACE,
        discriminator_hex: hex_of(&PASSPORT_BINDING_DISCRIMINATOR),
        fields: passport_binding_fields(),
        sample,
        golden_hex: hex_of(&payload),
        modelled_byte_length: PassportBinding::SPACE,
    }
}

pub fn build_state_manifest() -> StateManifest {
    StateManifest {
        version: 1,
        layouts: vec![
            passport_state_layout(),
            stake_account_layout(),
            challenge_account_layout(),
            passport_config_layout(),
            encumbrance_answer_layout(),
            passport_binding_layout(),
        ],
    }
}

pub fn state_manifest_json_pretty() -> String {
    let mut text =
        serde_json::to_string_pretty(&build_state_manifest()).expect("serialize state manifest");
    if !text.ends_with('\n') {
        text.push_str("\n");
    }
    text
}

pub fn committed_state_manifest_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(STATE_MANIFEST_REL_PATH)
}

pub fn assert_committed_state_matches_regen() {
    let path = committed_state_manifest_path();
    let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "state_manifest_drift: missing committed {} ({e})",
            path.display()
        )
    });
    let regenerated = state_manifest_json_pretty();
    if committed != regenerated {
        panic!(
            "state_manifest_drift: committed {} differs from Rust BorshSerialize regen (byte identity)",
            path.display()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn committed_state_manifest_matches_regen() {
        assert_committed_state_matches_regen();
    }

    #[test]
    fn six_layouts_including_answer_and_binding() {
        let m = build_state_manifest();
        assert_eq!(m.layouts.len(), 6);
        for layout in &m.layouts {
            assert_eq!(
                layout.golden_byte_length,
                layout.golden_hex.len() / 2,
                "{} golden_byte_length must equal golden hex byte count",
                layout.id
            );
        }
        assert_eq!(m.layouts[0].id, "kar-passport/PassportState");
        assert_eq!(m.layouts[0].golden_byte_length, PASSPORT_STATE_SPACE);
        assert!(m.layouts[0].modelled_byte_length < PASSPORT_STATE_SPACE);
        assert_eq!(
            m.layouts[0].golden_hex.len(),
            PASSPORT_STATE_SPACE * 2,
            "golden is full padded hex"
        );
        assert_eq!(m.layouts[1].id, "kar-pro-staking/StakeAccount");
        assert_eq!(m.layouts[1].golden_byte_length, STAKE_ACCOUNT_SPACE);
        assert!(m.layouts[1].modelled_byte_length < STAKE_ACCOUNT_SPACE);

        assert_eq!(
            m.layouts[2].id,
            "kargain-bonded-challenge/ChallengeAccount"
        );
        assert_eq!(m.layouts[2].golden_byte_length, ChallengeAccount::SPACE);
        assert_eq!(m.layouts[2].modelled_byte_length, ChallengeAccount::SPACE);
        assert_eq!(
            m.layouts[2].golden_hex.len(),
            ChallengeAccount::SPACE * 2,
            "ChallengeAccount golden is exact SPACE (fully consumed)"
        );

        assert_eq!(m.layouts[3].id, "kar-passport/PassportConfig");
        assert!(
            m.layouts[3]
                .fields
                .last()
                .is_some_and(|f| f.ty == "remainder_unmodelled"),
            "PassportConfig must end with remainder_unmodelled"
        );
        assert_eq!(
            m.layouts[3].golden_hex.len(),
            m.layouts[3].golden_byte_length * 2,
            "PassportConfig golden_byte_length is the variable sample golden length"
        );
        assert!(
            m.layouts[3].modelled_byte_length < m.layouts[3].golden_byte_length,
            "modelled prefix shorter than full sample (populated vec tail)"
        );
        assert!(
            m.layouts[3]
                .fields
                .iter()
                .any(|f| f.name == "namespace" && f.ty == "u128"),
            "PassportConfig must declare namespace as u128"
        );

        assert_eq!(
            m.layouts[4].id,
            "kargain-encumbrance/EncumbranceAnswer"
        );
        assert_eq!(m.layouts[4].golden_byte_length, EncumbranceAnswer::SPACE);
        assert_eq!(m.layouts[4].modelled_byte_length, EncumbranceAnswer::SPACE);
        assert_eq!(m.layouts[4].golden_byte_length, 74);

        assert_eq!(
            m.layouts[5].id,
            "kargain-consignment-base/PassportBinding"
        );
        assert_eq!(m.layouts[5].golden_byte_length, PassportBinding::SPACE);
        assert_eq!(m.layouts[5].modelled_byte_length, PassportBinding::SPACE);
        assert_eq!(m.layouts[5].golden_byte_length, 41);
    }

    #[test]
    fn remainder_marker_after_field_is_refused() {
        let mut fields = passport_config_fields();
        fields.push(wrap_field(field_u8("bump")));
        let result = std::panic::catch_unwind(|| {
            assert_remainder_marker_is_terminal(&fields, "planted");
        });
        assert!(result.is_err(), "field after remainder_unmodelled must panic");
    }
}
