import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateViewsSwitchSql,
  liveQueryNotifyProcedureSql,
  LIVE_QUERY_CHANNEL,
  LIVE_QUERY_TRIGGER,
  notifyProcedureDiffersFromPonderDefect,
  parsePonderMetaNamesResult,
  PSQL_SINGLE_TRANSACTION_ARGS,
  VIEWS_STAGING,
  viewsSwitchNotifyUsesFinalNames,
  viewsSwitchRequiresSingleTransaction,
} from "../scripts/lib/ponder-views-switch.ts";

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

  it("B2: notifyProcedureDiffersFromPonderDefect fails when DELETE present", () => {
    const dirty = `${liveQueryNotifyProcedureSql("kargain")}
DELETE FROM live_query_tables;`;
    assert.equal(
      notifyProcedureDiffersFromPonderDefect(dirty),
      "notify procedure must not DELETE FROM live_query_tables",
    );
  });

  it("B2: live notify procedure matches Ponder shape (no DELETE)", () => {
    const ours = liveQueryNotifyProcedureSql("kargain");
    assert.equal(notifyProcedureDiffersFromPonderDefect(ours), null);
    assert.ok(!ours.includes("DELETE FROM live_query_tables"));
  });
});
