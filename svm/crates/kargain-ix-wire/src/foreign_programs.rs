//! Well-known foreign program ids (chain-invariant).
//!
//! Sibling of `ix.manifest.json` / `pda.manifest.json` — not mixed into their
//! entries. Authority: Rust constants (`mpl_core::ID`, `system_program::ID`).
//! Not commercial deployment rows; LayerZero ids stay out.

use serde::Serialize;

pub const FOREIGN_PROGRAMS_MANIFEST_REL_PATH: &str = "foreign-programs.manifest.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignProgramEntry {
    pub id: String,
    pub address: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ForeignProgramsManifest {
    pub version: u32,
    pub programs: Vec<ForeignProgramEntry>,
}

pub fn build_foreign_programs_manifest() -> ForeignProgramsManifest {
    ForeignProgramsManifest {
        version: 1,
        programs: vec![
            ForeignProgramEntry {
                id: "mpl_core".into(),
                address: mpl_core::ID.to_string(),
            },
            ForeignProgramEntry {
                id: "system".into(),
                address: solana_program::system_program::ID.to_string(),
            },
        ],
    }
}

pub fn foreign_programs_manifest_json_pretty() -> String {
    let mut text = serde_json::to_string_pretty(&build_foreign_programs_manifest())
        .expect("serialize foreign-programs manifest");
    if !text.ends_with('\n') {
        text.push('\n');
    }
    text
}

pub fn committed_foreign_programs_manifest_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(FOREIGN_PROGRAMS_MANIFEST_REL_PATH)
}

pub fn assert_committed_foreign_programs_matches_regen() {
    let path = committed_foreign_programs_manifest_path();
    let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "foreign_programs_manifest_drift: missing committed {} ({e})",
            path.display()
        )
    });
    let regenerated = foreign_programs_manifest_json_pretty();
    if committed != regenerated {
        panic!(
            "foreign_programs_manifest_drift: committed {} differs from Rust mpl_core::ID / system_program::ID regen (byte identity)",
            path.display()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn committed_foreign_programs_manifest_matches_regen() {
        assert_committed_foreign_programs_matches_regen();
    }

    #[test]
    fn foreign_programs_are_mpl_core_and_system() {
        let m = build_foreign_programs_manifest();
        assert_eq!(m.programs.len(), 2);
        assert_eq!(m.programs[0].id, "mpl_core");
        assert_eq!(m.programs[0].address, mpl_core::ID.to_string());
        assert_eq!(m.programs[1].id, "system");
        assert_eq!(
            m.programs[1].address,
            solana_program::system_program::ID.to_string()
        );
    }
}
