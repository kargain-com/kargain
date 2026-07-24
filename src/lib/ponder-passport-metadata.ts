import { eq, type ReadonlyDrizzle } from "ponder";

import type { IndexedPassportMetadata } from "../../lib/passport/index-passport-metadata";
import { fetchMetadataFromUri } from "../../lib/passport/index-passport-metadata";
import { passport, vinIndex } from "../../ponder.schema";

export function passportMetadataDenorm(indexed: IndexedPassportMetadata) {
  return {
    vin: indexed.vin,
    make: indexed.make,
    model: indexed.model,
    year: indexed.year,
    mileageKm: indexed.mileageKm,
    fuelType: indexed.fuelType,
    bodyType: indexed.bodyType,
    transmission: indexed.transmission,
    condition: indexed.condition,
    vehicleType: indexed.vehicleType,
    colour: indexed.colour,
    locationLabel: indexed.locationLabel,
    locationPlaceId: indexed.locationPlaceId,
    locationCountryCode: indexed.locationCountryCode,
    coverPhotoUri: indexed.coverPhotoUri,
  };
}

/** Ponder 0.16 indexing `context` — use `db.find` / `db.sql`, not `db.select`. */
type IndexerContext = {
  db: {
    find: (
      table: typeof vinIndex,
      key: { id: string },
    ) => Promise<{ vin: string } | null>;
    insert: (table: typeof vinIndex) => {
      values: (values: {
        id: string;
        vin: string;
        tokenId: string;
        updatedAt: bigint;
      }) => {
        onConflictDoUpdate: (values: {
          vin: string;
          updatedAt: bigint;
        }) => Promise<unknown>;
      };
    };
    update: (
      table: typeof passport,
      key: { id: string },
    ) => {
      set: (values: Record<string, unknown>) => Promise<unknown>;
    };
    delete: (table: typeof vinIndex, key: { id: string }) => Promise<boolean>;
    sql: ReadonlyDrizzle;
  };
};

export async function recomputeDuplicateVin(
  context: IndexerContext,
  vin: string,
): Promise<void> {
  if (!vin) return;
  const rows = await context.db.sql
    .select({ tokenId: vinIndex.tokenId })
    .from(vinIndex)
    .where(eq(vinIndex.vin, vin));
  const isDuplicate = rows.length > 1;
  for (const row of rows) {
    if (!row.tokenId) continue;
    await context.db.update(passport, { id: row.tokenId }).set({ duplicateVin: isDuplicate });
  }
}

export async function indexPassportMetadataFromUri(
  context: IndexerContext,
  tokenId: string,
  tokenUri: string,
  timestamp: bigint,
): Promise<void> {
  const indexed = await fetchMetadataFromUri(tokenUri);

  const existing = await context.db.find(vinIndex, { id: tokenId });
  const oldVin = existing?.vin ?? "";

  if (oldVin && oldVin !== (indexed?.vin ?? "")) {
    await context.db.delete(vinIndex, { id: tokenId });
    await recomputeDuplicateVin(context, oldVin);
  }

  if (indexed?.vin) {
    await context.db
      .insert(vinIndex)
      .values({
        id: tokenId,
        vin: indexed.vin,
        tokenId,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        vin: indexed.vin,
        updatedAt: timestamp,
      });
    await recomputeDuplicateVin(context, indexed.vin);
  }

  if (indexed) {
    await context.db.update(passport, { id: tokenId }).set(passportMetadataDenorm(indexed));
  }
}
