/**
 * Sole owner of the writer's Postgres table schema for product raw SQL.
 *
 * Ponder's own `db` pool sets search_path to DATABASE_SCHEMA; product SQL in
 * src/lib uses its own pg.Pool and must qualify through this owner (ADR 0015 §b).
 */

export const WRITER_SCHEMA_ENV_KEY = "DATABASE_SCHEMA";

/** Exactly `kargain`, or `k_` + 40 lowercase hex (deploy commit schema). */
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
export function ponderWriterSchema(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (cached !== undefined && env === process.env) return cached;
  const raw = env[WRITER_SCHEMA_ENV_KEY];
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
  if (env === process.env) cached = raw;
  return raw;
}

/** Double-quote a Postgres identifier (schema or table). */
export function quotePgIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

/** Quoted `schema.table` for raw SQL. */
export function ponderQualifiedTable(
  table: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return `${quotePgIdent(ponderWriterSchema(env))}.${quotePgIdent(table)}`;
}

/** Test-only: clear the process.env cache after fixture schema changes. */
export function resetPonderWriterSchemaCacheForTests(): void {
  cached = undefined;
}
