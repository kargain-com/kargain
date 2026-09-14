//! Rewrite committed `state.manifest.json` from Rust BorshSerialize samples.
//! Goldens are never produced by the TypeScript account-state decoder.

use std::process::ExitCode;

fn main() -> ExitCode {
    let path = kargain_ix_wire::state::committed_state_manifest_path();
    let json = kargain_ix_wire::state::state_manifest_json_pretty();
    if let Err(e) = std::fs::write(&path, json) {
        eprintln!(
            "emit-state-manifest: failed to write {}: {e}",
            path.display()
        );
        return ExitCode::FAILURE;
    }
    let count = kargain_ix_wire::state::build_state_manifest().layouts.len();
    eprintln!(
        "emit-state-manifest: wrote {} ({} layouts)",
        path.display(),
        count
    );
    ExitCode::SUCCESS
}
