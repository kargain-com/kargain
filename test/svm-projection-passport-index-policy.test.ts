/**
 * SVM projection.passport indexes mirror PASSPORT_BROWSE_INDEXES (both directions).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { PASSPORT_BROWSE_INDEXES } from "../src/lib/passport-browse-index-contract.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECTION_SCHEMA = path.join(
  ROOT,
  "src/svm-ingest/db/projection-schema.sql",
);

type DeclaredIndex = {
  schemaKey: string;
  form: "column" | "lower";
  column: string;
};

function snakeColumn(column: string): string {
  if (column === "mileageKm") return "mileage_km";
  if (column === "fuelType") return "fuel_type";
  if (column === "bodyType") return "body_type";
  if (column === "vehicleType") return "vehicle_type";
  if (column === "locationPlaceId") return "location_place_id";
  return column;
}

function parseProjectionPassportIndexes(source: string): DeclaredIndex[] {
  const block = source.match(
    /CREATE TABLE IF NOT EXISTS kargain_svm_projection\.passport[\s\S]*?CREATE INDEX IF NOT EXISTS passport_status_idx/,
  );
  assert.ok(block, "projection passport table block not found");
  const indexSection = source.slice(source.indexOf("CREATE INDEX IF NOT EXISTS passport_status_idx"));
  const out: DeclaredIndex[] = [];
  const re =
    /passport_(\w+)_idx[\s\S]*?ON kargain_svm_projection\.passport \((?:lower\((\w+)\)|(\w+))\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(indexSection)) != null) {
    const schemaKey = `${m[1]}Idx`;
    if (m[2]) {
      out.push({ schemaKey, form: "lower", column: m[2]! });
    } else {
      out.push({ schemaKey, form: "column", column: m[3]! });
    }
  }
  return out;
}

describe("svm projection passport index ↔ predicate policy", () => {
  it("projection schema includes every PASSPORT_BROWSE_INDEXES entry", () => {
    const src = fs.readFileSync(PROJECTION_SCHEMA, "utf8");
    for (const entry of PASSPORT_BROWSE_INDEXES) {
      const snake = snakeColumn(entry.column);
      const needle =
        entry.form === "lower"
          ? `lower(${snake})`
          : snake;
      assert.ok(src.includes(needle), `${entry.schemaKey} → ${needle}`);
    }
  });

  it("projection schema declares a btree for each allowlisted browse column", () => {
    const src = fs.readFileSync(PROJECTION_SCHEMA, "utf8");
    const declared = parseProjectionPassportIndexes(src);
    for (const entry of PASSPORT_BROWSE_INDEXES) {
      const snake = snakeColumn(entry.column);
      const match = declared.find(
        (d) =>
          d.form === entry.form &&
          d.column === snake,
      );
      assert.ok(match, `${entry.schemaKey} missing in projection schema`);
    }
  });
});
