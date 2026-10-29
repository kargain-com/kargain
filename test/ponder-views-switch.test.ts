import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  generateViewsSwitchSql,
  liveQueryNotifyProcedureSql,
  LIVE_QUERY_CHANNEL,
  LIVE_QUERY_TRIGGER,
  parsePonderMetaNamesResult,
  PSQL_SINGLE_TRANSACTION_ARGS,
  VIEWS_STAGING,
  viewsSwitchNotifyUsesFinalNames,
  viewsSwitchRequiresSingleTransaction,
} from "../scripts/lib/ponder-views-switch.ts";

/**
 * Render Ponder's own getLiveQueryNotifyProcedureSql template (installed source) for a
 * schema + channel. Throws when the source cannot be read or the template is not found —
 * an unreadable source is a red test, never a skip (R11).
 */
function renderPonderNotifyProcedureSql(
  onchainPath: string,
  schema: string,
  channel: string,
): string {
  const src = readFileSync(onchainPath, "utf8");
  const start = src.indexOf("export const getLiveQueryNotifyProcedureSql");
  assert.ok(start >= 0, "ponder getLiveQueryNotifyProcedureSql not found");
  const m = src.slice(start).match(/return `([\s\S]*?)`;\n\};/);
  assert.ok(m, "ponder notify procedure template not found");
  const render = new Function(
    "schema",
    "channel",
    "tempTableName",
    "getLiveQueryNotifyProcedureName",
    `return \`${m[1]}\`;`,
  ) as (
    schema: string,
    channel: string,
    tempTableName: string,
    procedureName: () => string,
  ) => string;
  return render(schema, channel, "live_query_tables", () => "live_query_notify()");
}

// Installed ponder@0.18.2 source (package `exports` hides package.json from resolve).
const PONDER_ONCHAIN_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "../node_modules/ponder/src/drizzle/onchain.ts",
);

describe("ponder-views-switch", () => {
  const target = "k_" + "d".repeat(40);

  it("emits single-transaction args for the executor", () => {
    const invocation = `psql ${PSQL_SINGLE_TRANSACTION_ARGS.join(" ")}`;
    assert.equal(viewsSwitchRequiresSingleTransaction(invocation), true);
  });

  it("constructed: views-switch SQL without --single-transaction is red", () => {
    assert.equal(
      viewsSwitchRequiresSingleTransaction("psql -v ON_ERROR_STOP=1"),
      false,
    );
  });

  it("notify trigger uses final kargain names, not staging", () => {
    const sql = generateViewsSwitchSql({
      targetSchema: target,
      kind: "normal",
      renameLiveTo: "kargain_views_prev",
      tableNames: ["passport"],
      viewNames: [],
    });
    assert.equal(viewsSwitchNotifyUsesFinalNames(sql), true);
    assert.ok(sql.includes(LIVE_QUERY_TRIGGER));
    assert.ok(sql.includes(LIVE_QUERY_CHANNEL));
    assert.ok(!sql.includes(`${VIEWS_STAGING}_live_query_notify`));
  });

  it("constructed: notify trigger named from staging schema is red", () => {
    const dirty = `
CREATE OR REPLACE TRIGGER "${VIEWS_STAGING}_live_query_notify"
AFTER INSERT ON "${target}"."_ponder_checkpoint"
FOR EACH STATEMENT EXECUTE PROCEDURE "${VIEWS_STAGING}".live_query_notify();
PERFORM pg_notify('${VIEWS_STAGING}_live_query', '[]');
`;
    assert.equal(viewsSwitchNotifyUsesFinalNames(dirty), false);
  });

  it("first_cutover renames kargain to legacy schema", () => {
    const legacy = "k_" + "e".repeat(40);
    const sql = generateViewsSwitchSql({
      targetSchema: target,
      kind: "first_cutover",
      renameLiveTo: legacy,
      tableNames: ["passport"],
      viewNames: [],
    });
    assert.ok(sql.includes(`ALTER SCHEMA "kargain" RENAME TO "${legacy}"`));
    assert.ok(!sql.includes("kargain_views_prev"));
  });

  it("B1: empty table_names refuses before DDL", () => {
    assert.throws(
      () =>
        generateViewsSwitchSql({
          targetSchema: target,
          kind: "normal",
          renameLiveTo: "kargain_views_prev",
          tableNames: [],
          viewNames: [],
        }),
      /deploy_switch_failed: views_meta/,
    );
  });

  it("B1: parsePonderMetaNamesResult refuses empty table_names", () => {
    assert.throws(
      () =>
        parsePonderMetaNamesResult({
          tableNamesJson: "[]",
          viewNamesJson: "[]",
          rowPresent: true,
        }),
      /deploy_switch_failed: views_meta/,
    );
  });

  it("B1: parsePonderMetaNamesResult refuses absent row", () => {
    assert.throws(
      () =>
        parsePonderMetaNamesResult({
          tableNamesJson: null,
          viewNamesJson: null,
          rowPresent: false,
        }),
      /deploy_switch_failed: views_meta/,
    );
  });

  it("B2: our notify procedure is string-equal to Ponder 0.18.2's template", () => {
    const ponder = renderPonderNotifyProcedureSql(
      PONDER_ONCHAIN_SRC,
      VIEWS_STAGING,
      LIVE_QUERY_CHANNEL,
    );
    const ours = liveQueryNotifyProcedureSql(VIEWS_STAGING, LIVE_QUERY_CHANNEL);
    assert.equal(ours.trim(), ponder.trim());
  });

  it("constructed: B2 notify procedure with an extra DELETE is not equal to Ponder's", () => {
    const ponder = renderPonderNotifyProcedureSql(
      PONDER_ONCHAIN_SRC,
      VIEWS_STAGING,
      LIVE_QUERY_CHANNEL,
    );
    const dirty = liveQueryNotifyProcedureSql(
      VIEWS_STAGING,
      LIVE_QUERY_CHANNEL,
    ).replace(
      "RETURN NULL;\n  END;",
      "DELETE FROM live_query_tables;\n    RETURN NULL;\n  END;",
    );
    assert.notEqual(dirty, liveQueryNotifyProcedureSql(VIEWS_STAGING, LIVE_QUERY_CHANNEL));
    assert.notEqual(dirty.trim(), ponder.trim());
  });

  it("constructed: B2 fails (throws) when Ponder's source cannot be read", () => {
    assert.throws(
      () =>
        renderPonderNotifyProcedureSql(
          join(dirname(PONDER_ONCHAIN_SRC), "does-not-exist.ts"),
          VIEWS_STAGING,
          LIVE_QUERY_CHANNEL,
        ),
      /ENOENT/,
    );
  });
});
