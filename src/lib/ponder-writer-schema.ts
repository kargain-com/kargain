/**
 * Sole owner of the writer's Postgres schema for product raw SQL (ADR 0016 §d).
 *
 * Ponder's own `db` pool is scoped to DATABASE_SCHEMA; product SQL in src/lib
 * runs on its own pg.Pool and qualifies every Ponder table through this owner.
 * The value comes from the writer image's `ENV` and works unchanged under
 * `ponder serve` on the same schema.
 *
 * Guards: test/ponder-writer-schema.test.ts, test/ponder-writer-schema-policy.test.ts
 */

export const WRITER_SCHEMA_ENV_KEY = "DATABASE_SCHEMA";

/** `k_` + 40 lowercase hex of the indexing identity, or exactly `kargain` (legacy). */
const WRITER_SCHEMA_RE = /^(?:kargain|k_[0-9a-f]{40})$/;

export class PonderWriterSchemaError extends Error {
  readonly code = "ponder_writer_schema_invalid" as const;

  constructor(message: string) {
    super(message);
    this.name = "PonderWriterSchemaError";
  }
}

let cached: string | undefined;

/**
 * Validated writer schema from DATABASE_SCHEMA.
 * Missing or invalid → named error at first use.
 */
export function ponderWriterSchema(): string {
  if (cached !== undefined) return cached;
  const raw = process.env.DATABASE_SCHEMA;
  if (raw === undefined || raw === "") {
    throw new PonderWriterSchemaError(
      `ponder_writer_schema_invalid: missing ${WRITER_SCHEMA_ENV_KEY}`,
    );
  }
  if (!WRITER_SCHEMA_RE.test(raw)) {
    throw new PonderWriterSchemaError(
      `ponder_writer_schema_invalid: ${JSON.stringify(raw)}`,
    );
  }
  cached = raw;
  return raw;
}

/** Double-quote a Postgres identifier (schema or table). */
export function quotePgIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

/** Quoted `schema.table` for raw SQL. */
export function ponderQualifiedTable(table: string): string {
  return `${quotePgIdent(ponderWriterSchema())}.${quotePgIdent(table)}`;
}

/** Test-only: clear the cache after a fixture changes DATABASE_SCHEMA. */
export function resetPonderWriterSchemaCacheForTests(): void {
  cached = undefined;
}
