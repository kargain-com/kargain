//! PDA recipe census.
//!
//! Authority: real `Pubkey::find_program_address` via each owner's `*_pda` helper.
//! Committed artifact: `pda.manifest.json` (seed tags + dynamic encodings + golden).
//!
//! All goldens use `SYNTHETIC_PDA_PROGRAM_ID_BYTES` — never a live commercial
//! program id from `COMMERCIAL_ACTIVE` or any deployment manifest.

mod samples;

use serde::Serialize;
use serde_json::{Map, Value};

pub const PDA_MANIFEST_REL_PATH: &str = "pda.manifest.json";

/// Fixed synthetic program id for every golden. Documented 32-byte constant:
/// `0x11` repeated. Not a live commercial or deployment program id.
pub const SYNTHETIC_PDA_PROGRAM_ID_BYTES: [u8; 32] = [0x11; 32];

/// Live Solana Devnet commercial program ids (base58) — must never appear in the
/// committed PDA artifact. Source: `COMMERCIAL_ACTIVE` SVM row.
const LIVE_COMMERCIAL_PROGRAM_IDS: &[&str] = &[
    "ArvcryxBL1mP44Vo4MoK1FE3YCnNG8JdVa3iTKxgWnTQ", // karPassport
    "4TE2kf7N4F43ab1436KA71ZwKKokdGt7ANRDbreWbnHr", // karProPass
    "8tts6h74Uos5FuUJMEQ8uQd5oPXfKZ41Xfid9D6iZvXY", // karProStaking
    "9ugwozoJteH4D5XQmwvprevsZ6uWLoHEcWZWeVbDn693", // bridgeGateway
    "HmKV5QEVQLdpCiyQAvP4dpqPDBUedi35RSCcWL5XTxyu", // fixedPriceConsignment
    "HMGnyNMFNi9Rjakrch3iAfmoNWRFK7DEBzsEyLiQNt74", // ascendingConsignment
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdaDynamicDecl {
    pub name: String,
    pub encoding: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdaManifestRecipe {
    pub owner: String,
    pub id: String,
    pub seed_tag_hex: String,
    pub dynamics: Vec<PdaDynamicDecl>,
    pub sample: Map<String, Value>,
    pub golden_address: String,
    pub golden_bump: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdaManifest {
    pub version: u32,
    /// Exact 64-char hex of `SYNTHETIC_PDA_PROGRAM_ID_BYTES`.
    pub synthetic_program_id_hex: String,
    pub recipes: Vec<PdaManifestRecipe>,
}

pub fn build_pda_manifest() -> PdaManifest {
    PdaManifest {
        version: 1,
        synthetic_program_id_hex: crate::hex_of(&SYNTHETIC_PDA_PROGRAM_ID_BYTES),
        recipes: samples::all_pda_recipes(),
    }
}

pub fn pda_manifest_json_pretty() -> String {
    let mut text =
        serde_json::to_string_pretty(&build_pda_manifest()).expect("serialize pda manifest");
    if !text.ends_with('\n') {
        text.push('\n');
    }
    refuse_live_program_ids_in_artifact(&text);
    text
}

pub fn committed_pda_manifest_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(PDA_MANIFEST_REL_PATH)
}

pub fn assert_committed_pda_matches_regen() {
    let path = committed_pda_manifest_path();
    let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "pda_manifest_drift: missing committed {} ({e})",
            path.display()
        )
    });
    refuse_live_program_ids_in_artifact(&committed);
    let regenerated = pda_manifest_json_pretty();
    if committed != regenerated {
        panic!(
            "pda_manifest_drift: committed {} differs from Rust find_program_address regen (byte identity)",
            path.display()
        );
    }
}

fn refuse_live_program_ids_in_artifact(text: &str) {
    for id in LIVE_COMMERCIAL_PROGRAM_IDS {
        if text.contains(id) {
            panic!(
                "live_program_id_in_pda_manifest: committed PDA artifact must not contain live commercial program id {id}"
            );
        }
    }
}

pub(crate) fn dynamic_bytes32(name: &str) -> PdaDynamicDecl {
    PdaDynamicDecl {
        name: name.into(),
        encoding: "bytes32".into(),
    }
}

pub(crate) fn dynamic_u32_le(name: &str) -> PdaDynamicDecl {
    PdaDynamicDecl {
        name: name.into(),
        encoding: "u32_le".into(),
    }
}

pub(crate) fn dynamic_u32_be(name: &str) -> PdaDynamicDecl {
    PdaDynamicDecl {
        name: name.into(),
        encoding: "u32_be".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn committed_pda_manifest_matches_regen() {
        assert_committed_pda_matches_regen();
    }

    #[test]
    fn pda_census_is_thirty() {
        let m = build_pda_manifest();
        assert_eq!(
            m.recipes.len(),
            30,
            "pda census floor: 20 program-local + 10 shared-crate = 30"
        );
    }

    #[test]
    fn synthetic_program_id_is_documented_constant() {
        assert_eq!(SYNTHETIC_PDA_PROGRAM_ID_BYTES, [0x11; 32]);
        let m = build_pda_manifest();
        assert_eq!(m.synthetic_program_id_hex, "11".repeat(32));
    }

    #[test]
    fn claim_and_claim_ata_differ() {
        let m = build_pda_manifest();
        let claim = m
            .recipes
            .iter()
            .find(|r| r.id == "kargain-claimable-payouts/claim")
            .expect("claim recipe");
        let claim_ata = m
            .recipes
            .iter()
            .find(|r| r.id == "kargain-claimable-payouts/claim_ata")
            .expect("claim_ata recipe");
        assert_eq!(claim.sample, claim_ata.sample);
        assert_ne!(claim.golden_address, claim_ata.golden_address);
        assert_ne!(claim.seed_tag_hex, claim_ata.seed_tag_hex);
    }
}
