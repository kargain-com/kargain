/**
 * Writer schema owner (ADR 0015 §b): validate DATABASE_SCHEMA and quote tables.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import {
  PonderWriterSchemaError,
  ponderQualifiedTable,
  ponderWriterSchema,
  quotePgIdent,
  resetPonderWriterSchemaCacheForTests,
} from "../src/lib/ponder-writer-schema.js";

describe("ponderWriterSchema", () => {
  const prev = process.env.DATABASE_SCHEMA;

  beforeEach(() => {
    resetPonderWriterSchemaCacheForTests();
    delete process.env.DATABASE_SCHEMA;
  });

  afterEach(() => {
    resetPonderWriterSchemaCacheForTests();
    if (prev === undefined) delete process.env.DATABASE_SCHEMA;
    else process.env.DATABASE_SCHEMA = prev;
  });

  it("accepts kargain", () => {
    process.env.DATABASE_SCHEMA = "kargain";
    assert.equal(ponderWriterSchema(), "kargain");
    assert.equal(ponderQualifiedTable("passport"), '"kargain"."passport"');
  });

  it("accepts k_<40-hex>", () => {
    const schema = "k_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.DATABASE_SCHEMA = schema;
    assert.equal(ponderWriterSchema(), schema);
    assert.equal(
      ponderQualifiedTable("consignment"),
      `"${schema}"."consignment"`,
    );
  });

  it("refuses missing DATABASE_SCHEMA", () => {
    assert.throws(
      () => ponderWriterSchema(),
      (err: unknown) =>
        err instanceof PonderWriterSchemaError &&
        err.code === "ponder_writer_schema_invalid" &&
        /missing DATABASE_SCHEMA/.test(err.message),
    );
  });

  it("refuses invalid schema names", () => {
    for (const bad of [
      "Kargain",
      "kargain_views",
      "k_abc",
      "k_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "public",
    ]) {
      resetPonderWriterSchemaCacheForTests();
      process.env.DATABASE_SCHEMA = bad;
      assert.throws(
        () => ponderWriterSchema(),
        PonderWriterSchemaError,
        bad,
      );
    }
  });

  it("quotePgIdent doubles embedded quotes", () => {
    assert.equal(quotePgIdent('a"b'), '"a""b"');
  });
});
