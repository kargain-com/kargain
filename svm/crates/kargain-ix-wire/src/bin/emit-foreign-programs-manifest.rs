//! Rewrite committed `foreign-programs.manifest.json` from Rust constants.
//! Ids are never authored in TypeScript.

use std::process::ExitCode;

fn main() -> ExitCode {
    let path = kargain_ix_wire::foreign_programs::committed_foreign_programs_manifest_path();
    let json = kargain_ix_wire::foreign_programs::foreign_programs_manifest_json_pretty();
    if let Err(e) = std::fs::write(&path, json) {
        eprintln!(
            "emit-foreign-programs-manifest: failed to write {}: {e}",
            path.display()
        );
        return ExitCode::FAILURE;
    }
    let count = kargain_ix_wire::foreign_programs::build_foreign_programs_manifest()
        .programs
        .len();
    eprintln!(
        "emit-foreign-programs-manifest: wrote {} ({} programs)",
        path.display(),
        count
    );
    ExitCode::SUCCESS
}
