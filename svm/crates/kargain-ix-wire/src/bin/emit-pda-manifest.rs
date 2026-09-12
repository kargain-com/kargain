//! Rewrite committed `pda.manifest.json` from Rust `find_program_address` samples.
//! Goldens are never produced by the TypeScript PDA owner.

use std::process::ExitCode;

fn main() -> ExitCode {
    let path = kargain_ix_wire::pda::committed_pda_manifest_path();
    let json = kargain_ix_wire::pda::pda_manifest_json_pretty();
    if let Err(e) = std::fs::write(&path, json) {
        eprintln!("emit-pda-manifest: failed to write {}: {e}", path.display());
        return ExitCode::FAILURE;
    }
    let count = kargain_ix_wire::pda::build_pda_manifest().recipes.len();
    eprintln!(
        "emit-pda-manifest: wrote {} ({} recipes)",
        path.display(),
        count
    );
    ExitCode::SUCCESS
}
