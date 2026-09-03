import { eq } from "ponder";

import type { IndexedPassportMetadata } from "../../lib/passport/index-passport-metadata";
import { fetchMetadataFromUri } from "../../lib/passport/index-passport-metadata";
import { passport, vinIndex } from "../../ponder.schema";

/**
 * Structural minimum of Ponder handler `context` for metadata helpers.
 * Method syntax keeps parameters bivariant so the real `ponder.on` context
 * remains assignable without importing `ponder:registry` into the node graph.
 * Query row shapes are opaque here — narrowed at the call after await.
 */
type IndexerContext = {
  db: {
    sql: {
      select(fields: unknown): {
        from(table: unknown): {
          where(condition: unknown): Promise<unknown>;
        };
      };
    };
    find(
      table: unknown,
      key: { id: string },
    ): Promise<{ vin?: string } | null>;
    update(
      table: unknown,
      key: { id: string },
    ): {
      set(values: unknown): Promise<unknown>;
    };
    delete(table: unknown, key: { id: string }): Promise<unknown>;
    insert(table: unknown): {
      values(values: unknown): {
        onConflictDoUpdate(values: unknown): Promise<unknown>;
      };
    };
  };
};

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

export async function recomputeDuplicateVin(
  context: IndexerContext,
  vin: string,
): Promise<void> {
  if (!vin) return;
  const rowsUnknown = await context.db.sql
    .select({ tokenId: vinIndex.tokenId })
    .from(vinIndex)
    .where(eq(vinIndex.vin, vin));
  if (!Array.isArray(rowsUnknown)) {
    throw new Error("vinIndex select returned non-array");
  }
  const rows = rowsUnknown as Array<{ tokenId: string | null }>;
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
