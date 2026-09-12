//! Rewrite committed `ix.manifest.json` from Rust BorshSerialize samples.
//! Goldens are never produced by the TypeScript encoder.

use std::process::ExitCode;

fn main() -> ExitCode {
    let path = kargain_ix_wire::committed_manifest_path();
    let json = kargain_ix_wire::manifest_json_pretty();
    if let Err(e) = std::fs::write(&path, json) {
        eprintln!("emit-ix-manifest: failed to write {}: {e}", path.display());
        return ExitCode::FAILURE;
    }
    let count = kargain_ix_wire::build_manifest().entries.len();
    eprintln!(
        "emit-ix-manifest: wrote {} ({} entries)",
        path.display(),
        count
    );
    ExitCode::SUCCESS
}
