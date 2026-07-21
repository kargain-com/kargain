/**
 * Verifier row lifecycle for Ponder handlers.
 *
 * Indexers observe a bounded event window (start block, reindex checkpoints).
 * Creation events upsert rows; mutation and deactivation patch only when a row
 * exists — absent row means desired state already holds (idempotent no-op).
 *
 * Verifier PK is chain-scoped: `${chainId}-${address.toLowerCase()}` (SPEC §I.12.12).
 */

import { verifier } from "../../ponder.schema";

export type VerifierRow = {
  id: string;
  chainId: number;
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
    | "chainId"
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

/** Chain-scoped verifier PK (SPEC §I.12.12). */
export function normalizeVerifierId(chainId: number, address: string): string {
  return `${chainId}-${address.toLowerCase()}`;
}

export function verifierJoinedRow(
  chainId: number,
  verifierAddress: string,
  asset: number,
  amount: bigint,
  timestamp: bigint,
): VerifierRow {
  const id = normalizeVerifierId(chainId, verifierAddress);
  return {
    id,
    chainId,
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
  chainId: number,
  verifierAddress: string,
  asset: number,
  amount: bigint,
  timestamp: bigint,
): VerifierPatch {
  return {
    chainId,
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
  chainId: number,
  holder: string,
  category: number,
  name: string,
  metadataURI: string,
  slug: string,
): VerifierRow {
  const id = normalizeVerifierId(chainId, holder);
  return {
    id,
    chainId,
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
  chainId: number,
  holder: string,
  category: number,
  name: string,
  metadataURI: string,
  slug: string,
): VerifierPatch {
  return {
    chainId,
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
  chainId: number,
  verifierAddress: string,
  asset: number,
  amount: bigint,
  timestamp: bigint,
): Promise<void> {
  const row = verifierJoinedRow(chainId, verifierAddress, asset, amount, timestamp);
  await db
    .insert(verifier)
    .values(row)
    .onConflictDoUpdate(
      verifierJoinedConflictUpdate(chainId, verifierAddress, asset, amount, timestamp),
    );
}

export async function upsertVerifierFromProPassMint(
  db: VerifierIndexerDb,
  chainId: number,
  holder: string,
  category: number,
  name: string,
  metadataURI: string,
  slug: string,
): Promise<void> {
  const row = proPassMintedRow(chainId, holder, category, name, metadataURI, slug);
  await db
    .insert(verifier)
    .values(row)
    .onConflictDoUpdate(
      proPassMintedConflictUpdate(chainId, holder, category, name, metadataURI, slug),
    );
}
