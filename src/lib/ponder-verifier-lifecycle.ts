/**
 * Verifier row lifecycle for Ponder handlers.
 *
 * Indexers observe a bounded event window (start block, reindex checkpoints).
 * Creation events upsert rows; mutation and deactivation patch only when a row
 * exists — absent row means desired state already holds (idempotent no-op).
 */

import { verifier } from "../../ponder.schema";

export type VerifierRow = {
  id: string;
  address: string;
  category: number;
  name: string;
  slug: string;
  metadataURI: string;
  stakeAsset: number;
  stakeAmount: string;
  verificationFee: bigint;
  active: boolean;
  joinedAt: bigint;
  leftAt: bigint;
};

export type VerifierPatch = Partial<
  Pick<
    VerifierRow,
    | "address"
    | "category"
    | "name"
    | "slug"
    | "metadataURI"
    | "stakeAsset"
    | "stakeAmount"
    | "verificationFee"
    | "active"
    | "joinedAt"
    | "leftAt"
  >
>;

/** Ponder 0.16 indexing `context.db` subset for verifier table. */
export type VerifierIndexerDb = {
  find: (table: typeof verifier, key: { id: string }) => Promise<VerifierRow | null>;
  insert: (table: typeof verifier) => {
    values: (values: VerifierRow) => {
      onConflictDoUpdate: (values: VerifierPatch) => Promise<unknown>;
    };
  };
  update: (table: typeof verifier, key: { id: string }) => {
    set: (values: VerifierPatch) => Promise<unknown>;
  };
};

export function normalizeVerifierId(address: string): string {
  return address.toLowerCase();
}

export function verifierJoinedRow(
  verifierAddress: string,
  asset: number,
  amount: bigint,
  timestamp: bigint,
): VerifierRow {
  const id = normalizeVerifierId(verifierAddress);
  return {
    id,
    address: verifierAddress,
    category: 5,
    name: "",
    slug: "",
    metadataURI: "",
    stakeAsset: asset,
    stakeAmount: amount.toString(),
    verificationFee: 0n,
    active: true,
    joinedAt: timestamp,
    leftAt: 0n,
  };
}

export function verifierJoinedConflictUpdate(
  verifierAddress: string,
  asset: number,
  amount: bigint,
  timestamp: bigint,
): VerifierPatch {
  return {
    address: verifierAddress,
    stakeAsset: asset,
    stakeAmount: amount.toString(),
    active: true,
    joinedAt: timestamp,
  };
}

export function verifierLeftPatch(timestamp: bigint): VerifierPatch {
  return {
    active: false,
    stakeAmount: "0",
    leftAt: timestamp,
  };
}

export function verificationFeePatch(fee: bigint): VerifierPatch {
  return { verificationFee: fee };
}

export function proPassMintedRow(
  holder: string,
  category: number,
  name: string,
  metadataURI: string,
  slug: string,
): VerifierRow {
  const id = normalizeVerifierId(holder);
  return {
    id,
    address: holder,
    category,
    name,
    slug,
    metadataURI,
    stakeAsset: 0,
    stakeAmount: "0",
    verificationFee: 0n,
    active: true,
    joinedAt: 0n,
    leftAt: 0n,
  };
}

export function proPassMintedConflictUpdate(
  holder: string,
  category: number,
  name: string,
  metadataURI: string,
  slug: string,
): VerifierPatch {
  return {
    address: holder,
    category,
    name,
    slug,
    metadataURI,
    active: true,
  };
}

export function proPassProfilePatch(
  category: number,
  name: string,
  metadataURI: string,
  slug: string,
): VerifierPatch {
  return { category, name, slug, metadataURI };
}

export function proPassBurnedPatch(): VerifierPatch {
  return { active: false };
}

export async function patchVerifierIfExists(
  db: VerifierIndexerDb,
  id: string,
  patch: VerifierPatch,
): Promise<boolean> {
  const existing = await db.find(verifier, { id });
  if (!existing) return false;
  await db.update(verifier, { id }).set(patch);
  return true;
}

export async function upsertVerifierFromStakingJoin(
  db: VerifierIndexerDb,
  verifierAddress: string,
  asset: number,
  amount: bigint,
  timestamp: bigint,
): Promise<void> {
  const row = verifierJoinedRow(verifierAddress, asset, amount, timestamp);
  await db
    .insert(verifier)
    .values(row)
    .onConflictDoUpdate(
      verifierJoinedConflictUpdate(verifierAddress, asset, amount, timestamp),
    );
}

export async function upsertVerifierFromProPassMint(
  db: VerifierIndexerDb,
  holder: string,
  category: number,
  name: string,
  metadataURI: string,
  slug: string,
): Promise<void> {
  const row = proPassMintedRow(holder, category, name, metadataURI, slug);
  await db
    .insert(verifier)
    .values(row)
    .onConflictDoUpdate(
      proPassMintedConflictUpdate(holder, category, name, metadataURI, slug),
    );
}
