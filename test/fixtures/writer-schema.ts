/**
 * Test writer schema: fixtures set DATABASE_SCHEMA and build tables through
 * the same owner as production (ADR 0016 §d).
 */
import {
  ponderWriterSchema,
  resetPonderWriterSchemaCacheForTests,
} from "../../src/lib/ponder-writer-schema.js";

export function ensureTestWriterSchema(schema = "kargain"): string {
  process.env.DATABASE_SCHEMA = schema;
  resetPonderWriterSchemaCacheForTests();
  return ponderWriterSchema();
}
