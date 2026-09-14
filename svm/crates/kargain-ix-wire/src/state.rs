//! Account-state layout census (PassportState).
//!
//! Authority: Rust `BorshSerialize` of `kar_passport::state::PassportState`,
//! padded to `PASSPORT_STATE_SPACE`. Committed artifact: `state.manifest.json`.
//! Goldens are never produced by the TypeScript decoder.

use kar_passport::state::{
    PassportState, Status, PASSPORT_STATE_DISCRIMINATOR, PASSPORT_STATE_SPACE,
};
use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::{field_bool, field_fixed, field_u32, field_u64, field_u8, hex_of, FieldDecl};

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
    pub account_space: usize,
    pub discriminator_hex: String,
    pub fields: Vec<StateFieldDecl>,
    pub sample: Map<String, Value>,
    /// Borsh payload padded with trailing zeros to `account_space`.
    pub golden_hex: String,
    /// Unpadded borsh length (for cursor-vs-strict proofs).
    pub payload_len: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct StateManifest {
    pub version: u32,
    pub layouts: Vec<StateLayoutEntry>,
}

fn passport_state_fields() -> Vec<StateFieldDecl> {
    fn wrap(f: FieldDecl) -> StateFieldDecl {
        StateFieldDecl {
            name: f.name,
            ty: f.ty,
            len: f.len,
        }
    }
    vec![
        wrap(field_fixed("discriminator", 8)),
        wrap(field_fixed("token_id", 32)),
        // Status: borsh(use_discriminant = true) + repr(u8) → single u8 ordinal
        wrap(field_u8("status")),
        wrap(field_fixed("verifier", 32)),
        wrap(field_u64("verified_at")),
        wrap(field_bool("custody_locked")),
        wrap(field_bool("burned")),
        wrap(field_u32("record_count")),
        wrap(field_u8("bump")),
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
        account_space: PASSPORT_STATE_SPACE,
        discriminator_hex: hex_of(&PASSPORT_STATE_DISCRIMINATOR),
        fields: passport_state_fields(),
        sample,
        golden_hex: hex_of(&account),
        payload_len,
    }
}

pub fn build_state_manifest() -> StateManifest {
    StateManifest {
        version: 1,
        layouts: vec![passport_state_layout()],
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
    fn passport_state_is_the_only_layout() {
        let m = build_state_manifest();
        assert_eq!(m.layouts.len(), 1);
        assert_eq!(m.layouts[0].id, "kar-passport/PassportState");
        assert_eq!(m.layouts[0].account_space, PASSPORT_STATE_SPACE);
        assert!(m.layouts[0].payload_len < PASSPORT_STATE_SPACE);
        assert_eq!(
            m.layouts[0].golden_hex.len(),
            PASSPORT_STATE_SPACE * 2,
            "golden is full account space hex"
        );
    }
}
