/**
 * Sole product reader for chain-invariant foreign program ids.
 *
 * Authority: Rust `mpl_core::ID` / `system_program::ID` via committed
 * `foreign-programs.manifest.json` (sibling of ix/pda manifests). Not a
 * commercial deployment row — never `COMMERCIAL_ACTIVE`, never web3.js.
 */

import foreignProgramsManifest from "../../svm/crates/kargain-ix-wire/foreign-programs.manifest.json" with {
  type: "json",
};

export type ForeignProgramId = "mpl_core" | "system";

export type ForeignProgramEntry = {
  id: string;
  address: string;
};

export type ForeignProgramsManifest = {
  version: number;
  programs: ForeignProgramEntry[];
};

const MANIFEST = foreignProgramsManifest as ForeignProgramsManifest;

const BY_ID = new Map<string, string>(
  MANIFEST.programs.map((p) => [p.id, p.address]),
);

function requireForeignProgramAddress(id: ForeignProgramId): string {
  const address = BY_ID.get(id);
  if (address == null || address.length === 0) {
    throw new Error(`foreign_program_missing:${id}`);
  }
  return address;
}

/** Metaplex Core program id (`mpl_core::ID`). */
export function mplCoreProgramId(): string {
  return requireForeignProgramAddress("mpl_core");
}

/** Solana System program id (`system_program::ID`). */
export function systemProgramId(): string {
  return requireForeignProgramAddress("system");
}

/** Test/census seam — committed entries only. */
export function foreignProgramEntries(): readonly ForeignProgramEntry[] {
  return MANIFEST.programs;
}
