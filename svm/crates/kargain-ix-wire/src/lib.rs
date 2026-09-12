//! Commercial instruction wire census.
//!
//! Authority: Rust `BorshSerialize` of the six program instruction enums.
//! Committed artifact: `ix.manifest.json` (layout + deterministic sample + goldenHex).

mod samples;

use serde::Serialize;
use serde_json::{json, Map, Value};

pub const MANIFEST_REL_PATH: &str = "ix.manifest.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDecl {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub len: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub program: String,
    #[serde(rename = "enum")]
    pub enum_name: String,
    pub index: u8,
    pub name: String,
    pub fields: Vec<FieldDecl>,
    pub sample: Map<String, Value>,
    pub golden_hex: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Manifest {
    pub version: u32,
    pub entries: Vec<ManifestEntry>,
}

pub fn build_manifest() -> Manifest {
    Manifest {
        version: 1,
        entries: samples::all_entries(),
    }
}

pub fn manifest_json_pretty() -> String {
    let mut text = serde_json::to_string_pretty(&build_manifest()).expect("serialize manifest");
    if !text.ends_with('\n') {
        text.push('\n');
    }
    text
}

pub fn committed_manifest_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(MANIFEST_REL_PATH)
}

pub fn assert_committed_matches_regen() {
    let path = committed_manifest_path();
    let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "ix_manifest_drift: missing committed {} ({e})",
            path.display()
        )
    });
    let regenerated = manifest_json_pretty();
    if committed != regenerated {
        panic!(
            "ix_manifest_drift: committed {} differs from Rust BorshSerialize regen (byte identity)",
            path.display()
        );
    }
}

pub(crate) fn field_u8(name: &str) -> FieldDecl {
    FieldDecl {
        name: name.into(),
        ty: "u8".into(),
        len: None,
    }
}
pub(crate) fn field_u16(name: &str) -> FieldDecl {
    FieldDecl {
        name: name.into(),
        ty: "u16".into(),
        len: None,
    }
}
pub(crate) fn field_u32(name: &str) -> FieldDecl {
    FieldDecl {
        name: name.into(),
        ty: "u32".into(),
        len: None,
    }
}
pub(crate) fn field_u64(name: &str) -> FieldDecl {
    FieldDecl {
        name: name.into(),
        ty: "u64".into(),
        len: None,
    }
}
pub(crate) fn field_u128(name: &str) -> FieldDecl {
    FieldDecl {
        name: name.into(),
        ty: "u128".into(),
        len: None,
    }
}
pub(crate) fn field_bool(name: &str) -> FieldDecl {
    FieldDecl {
        name: name.into(),
        ty: "bool".into(),
        len: None,
    }
}
pub(crate) fn field_string(name: &str) -> FieldDecl {
    FieldDecl {
        name: name.into(),
        ty: "string".into(),
        len: None,
    }
}
pub(crate) fn field_vec_u8(name: &str) -> FieldDecl {
    FieldDecl {
        name: name.into(),
        ty: "vec_u8".into(),
        len: None,
    }
}
pub(crate) fn field_fixed(name: &str, len: usize) -> FieldDecl {
    FieldDecl {
        name: name.into(),
        ty: "fixed_bytes".into(),
        len: Some(len),
    }
}

pub(crate) fn b32(fill: u8) -> [u8; 32] {
    [fill; 32]
}

pub(crate) fn hex_of(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(s, "{b:02x}");
    }
    s
}

pub(crate) fn sample_u8(v: u8) -> Value {
    json!(v)
}
pub(crate) fn sample_u16(v: u16) -> Value {
    json!(v)
}
pub(crate) fn sample_u32(v: u32) -> Value {
    json!(v)
}
pub(crate) fn sample_u64(v: u64) -> Value {
    json!(v.to_string())
}
pub(crate) fn sample_u128(v: u128) -> Value {
    json!(v.to_string())
}
pub(crate) fn sample_bool(v: bool) -> Value {
    json!(v)
}
pub(crate) fn sample_string(v: &str) -> Value {
    json!(v)
}
pub(crate) fn sample_bytes(v: &[u8]) -> Value {
    json!(hex_of(v))
}

pub(crate) fn entry_from_borsh<T: borsh::BorshSerialize>(
    program: &str,
    enum_name: &str,
    name: &str,
    fields: Vec<FieldDecl>,
    sample: Map<String, Value>,
    ix: &T,
) -> ManifestEntry {
    let golden = borsh::to_vec(ix).expect("borsh serialize sample");
    let index = *golden
        .first()
        .expect("borsh enum always writes a discriminant byte");
    ManifestEntry {
        program: program.into(),
        enum_name: enum_name.into(),
        index,
        name: name.into(),
        fields,
        sample,
        golden_hex: hex_of(&golden),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn committed_manifest_matches_borsh_regen() {
        assert_committed_matches_regen();
    }

    #[test]
    fn census_is_ninety_eight() {
        let m = build_manifest();
        assert_eq!(
            m.entries.len(),
            98,
            "ix census floor: 21+8+7+3+27+32 = 98"
        );
    }
}
