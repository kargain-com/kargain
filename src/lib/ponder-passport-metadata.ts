import { count, eq } from "ponder";

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
  };
}

type DbContext = {
  db: {
    update: (
      table: typeof passport,
      where: { id: string },
    ) => { set: (values: Record<string, unknown>) => Promise<unknown> };
    insert: (table: typeof vinIndex) => {
      values: (values: Record<string, unknown>) => {
        onConflictDoUpdate: (values: Record<string, unknown>) => Promise<unknown>;
      };
    };
    delete: (
      table: typeof vinIndex,
      where: { id: string },
    ) => Promise<unknown>;
    select: (fields?: Record<string, unknown>) => {
      from: (table: typeof vinIndex) => {
        where: (condition: unknown) => Promise<Array<{ tokenId?: string; vin?: string }>>;
      };
    };
  };
};

export async function recomputeDuplicateVin(
  context: DbContext,
  vin: string,
): Promise<void> {
  if (!vin) return;
  const rows = await context.db
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
  context: DbContext,
  tokenId: string,
  tokenUri: string,
  timestamp: bigint,
): Promise<void> {
  const indexed = await fetchMetadataFromUri(tokenUri);

  const existingRows = await context.db
    .select({ vin: vinIndex.vin })
    .from(vinIndex)
    .where(eq(vinIndex.id, tokenId));
  const oldVin = existingRows[0]?.vin ?? "";

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
