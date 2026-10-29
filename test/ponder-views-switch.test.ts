import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateViewsSwitchSql,
  LIVE_QUERY_CHANNEL,
  LIVE_QUERY_TRIGGER,
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
      tableNames: [],
      viewNames: [],
    });
    assert.ok(sql.includes(`ALTER SCHEMA "kargain" RENAME TO "${legacy}"`));
    assert.ok(!sql.includes("kargain_views_prev"));
  });
});
