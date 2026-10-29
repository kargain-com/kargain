/**
 * Sole owner of the atomic Ponder views-switch SQL (ADR 0014 §b / #69).
 * Generates one script for `psql --single-transaction -v ON_ERROR_STOP=1`.
 * Notify channel/trigger use the final views-schema names (kargain_*), never the
 * staging schema string. Notify procedure body equals Ponder 0.18.2's template
 * (proved by string equality in test/ponder-views-switch.test.ts, B2 / R11).
 */
export const VIEWS_SCHEMA = "kargain";
export const VIEWS_STAGING = "kargain_views_next";
export const VIEWS_PREV = "kargain_views_prev";
export const LIVE_QUERY_CHANNEL = "kargain_live_query";
export const LIVE_QUERY_TRIGGER = "kargain_live_query_notify";
export const LIVE_QUERY_PROCEDURE = "live_query_notify()";
export const PONDER_META = "_ponder_meta";
export const PONDER_CHECKPOINT = "_ponder_checkpoint";

export const PSQL_SINGLE_TRANSACTION_ARGS = [
  "--single-transaction",
  "-v",
  "ON_ERROR_STOP=1",
] as const;

export type ViewsSwitchKind =
  | "normal"
  | "first_cutover"
  | "first_cutover_rollback";

export type ViewsSwitchInput = {
  targetSchema: string;
  kind: ViewsSwitchKind;
  renameLiveTo: string;
  tableNames: readonly string[];
  viewNames: readonly string[];
};

function qIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function createViewSql(staging: string, target: string, name: string): string {
  return `CREATE VIEW ${qIdent(staging)}.${qIdent(name)} AS SELECT * FROM ${qIdent(target)}.${qIdent(name)};`;
}

/**
 * Live-query notify procedure — byte-identical to Ponder 0.18.2
 * getLiveQueryNotifyProcedureSql (no DELETE FROM live_query_tables).
 */
export function liveQueryNotifyProcedureSql(
  schema: string,
  channel: string = LIVE_QUERY_CHANNEL,
): string {
  return `
CREATE OR REPLACE FUNCTION "${schema}".${LIVE_QUERY_PROCEDURE}
RETURNS TRIGGER LANGUAGE plpgsql
AS $$
  DECLARE
    current_payload text := '[';
    separator text := '';
    entry text;
    entry_json text;
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_name = 'live_query_tables'
      AND table_type = 'LOCAL TEMPORARY'
    ) THEN
      RETURN NULL;
    END IF;

    FOR entry IN SELECT table_name FROM live_query_tables ORDER BY table_name LOOP
      entry_json := to_json(entry)::text;

      IF current_payload <> '[' AND octet_length(current_payload) + octet_length(separator) + octet_length(entry_json) + 1 >= 7900 THEN
        PERFORM pg_notify('${channel}', current_payload || ']');
        current_payload := '[' || entry_json;
        separator := ',';
      ELSE
        current_payload := current_payload || separator || entry_json;
        separator := ',';
      END IF;
    END LOOP;

    IF current_payload = '[' THEN
      PERFORM pg_notify('${channel}', '[]');
    ELSE
      PERFORM pg_notify('${channel}', current_payload || ']');
    END IF;

    RETURN NULL;
  END;
$$;`.trim();
}

/**
 * Read table_names / view_names from _ponder_meta as Ponder 0.18.2 stores them:
 * key='app', value is the app object itself (B1) — not value->'app'.
 * No COALESCE-to-empty: absent row / absent key / empty table_names must fail.
 */
export function readPonderMetaNamesSql(deploymentSchema: string): string {
  return `
SELECT
  (value->'table_names')::text AS table_names,
  (value->'view_names')::text AS view_names
FROM ${qIdent(deploymentSchema)}.${qIdent(PONDER_META)}
WHERE key = 'app'
LIMIT 1;
`.trim();
}

export type ParsedMetaNames = {
  tableNames: string[];
  viewNames: string[];
};

/**
 * Parse the meta query result. Refuses empty/absent table_names (B1).
 */
export function parsePonderMetaNamesResult(args: {
  tableNamesJson: string | null | undefined;
  viewNamesJson: string | null | undefined;
  rowPresent: boolean;
}): ParsedMetaNames {
  if (!args.rowPresent) {
    throw new Error("deploy_switch_failed: views_meta");
  }
  if (
    args.tableNamesJson === null ||
    args.tableNamesJson === undefined ||
    args.tableNamesJson === "" ||
    args.tableNamesJson === "null"
  ) {
    throw new Error("deploy_switch_failed: views_meta");
  }
  let tableNames: unknown;
  let viewNames: unknown = [];
  try {
    tableNames = JSON.parse(args.tableNamesJson);
  } catch {
    throw new Error("deploy_switch_failed: views_meta");
  }
  if (
    args.viewNamesJson &&
    args.viewNamesJson !== "null" &&
    args.viewNamesJson !== ""
  ) {
    try {
      viewNames = JSON.parse(args.viewNamesJson);
    } catch {
      throw new Error("deploy_switch_failed: views_meta");
    }
  }
  if (!Array.isArray(tableNames) || tableNames.length === 0) {
    throw new Error("deploy_switch_failed: views_meta");
  }
  if (!Array.isArray(viewNames)) {
    throw new Error("deploy_switch_failed: views_meta");
  }
  if (!tableNames.every((t) => typeof t === "string")) {
    throw new Error("deploy_switch_failed: views_meta");
  }
  if (!viewNames.every((t) => typeof t === "string")) {
    throw new Error("deploy_switch_failed: views_meta");
  }
  return {
    tableNames: tableNames as string[],
    viewNames: viewNames as string[],
  };
}

export function generateViewsSwitchSql(input: ViewsSwitchInput): string {
  const { targetSchema, kind, renameLiveTo, tableNames, viewNames } = input;
  const lines: string[] = [];
  lines.push(`-- ponder-views-switch target=${targetSchema} kind=${kind}`);

  if (kind === "first_cutover_rollback") {
    // ADR §j: move views kargain aside, restore table schema name kargain
    lines.push(
      `ALTER SCHEMA ${qIdent(VIEWS_SCHEMA)} RENAME TO ${qIdent(VIEWS_STAGING)};`,
    );
    lines.push(
      `ALTER SCHEMA ${qIdent(renameLiveTo)} RENAME TO ${qIdent(VIEWS_SCHEMA)};`,
    );
    lines.push(`DROP SCHEMA ${qIdent(VIEWS_STAGING)} CASCADE;`);
    return `${lines.join("\n")}\n`;
  }

  if (tableNames.length === 0) {
    throw new Error("deploy_switch_failed: views_meta");
  }

  lines.push(`CREATE SCHEMA ${qIdent(VIEWS_STAGING)};`);

  for (const t of tableNames) {
    lines.push(createViewSql(VIEWS_STAGING, targetSchema, t));
  }
  for (const v of viewNames) {
    lines.push(createViewSql(VIEWS_STAGING, targetSchema, v));
  }
  lines.push(createViewSql(VIEWS_STAGING, targetSchema, PONDER_META));
  lines.push(createViewSql(VIEWS_STAGING, targetSchema, PONDER_CHECKPOINT));

  lines.push(liveQueryNotifyProcedureSql(VIEWS_STAGING, LIVE_QUERY_CHANNEL));
  lines.push(`
CREATE OR REPLACE TRIGGER ${qIdent(LIVE_QUERY_TRIGGER)}
AFTER INSERT OR UPDATE OR DELETE
ON ${qIdent(targetSchema)}.${qIdent(PONDER_CHECKPOINT)}
FOR EACH STATEMENT
EXECUTE PROCEDURE ${qIdent(VIEWS_STAGING)}.${LIVE_QUERY_PROCEDURE};
`.trim());

  if (kind === "first_cutover") {
    lines.push(
      `ALTER SCHEMA ${qIdent(VIEWS_SCHEMA)} RENAME TO ${qIdent(renameLiveTo)};`,
    );
    lines.push(
      `ALTER SCHEMA ${qIdent(VIEWS_STAGING)} RENAME TO ${qIdent(VIEWS_SCHEMA)};`,
    );
  } else {
    lines.push(
      `ALTER SCHEMA ${qIdent(VIEWS_SCHEMA)} RENAME TO ${qIdent(VIEWS_PREV)};`,
    );
    lines.push(
      `ALTER SCHEMA ${qIdent(VIEWS_STAGING)} RENAME TO ${qIdent(VIEWS_SCHEMA)};`,
    );
    lines.push(`
DO $$
DECLARE
  base_count integer;
BEGIN
  SELECT count(*) INTO base_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = '${VIEWS_PREV}'
    AND c.relkind = 'r';
  IF base_count > 0 THEN
    RAISE EXCEPTION 'deploy_switch_failed: views_prev_has_base_tables count=%', base_count;
  END IF;
  EXECUTE 'DROP SCHEMA ${qIdent(VIEWS_PREV)} CASCADE';
END $$;
`.trim());
  }

  return `${lines.join("\n")}\n`;
}

export function viewsSwitchRequiresSingleTransaction(invocation: string): boolean {
  return (
    invocation.includes("--single-transaction") &&
    invocation.includes("ON_ERROR_STOP=1")
  );
}

export function viewsSwitchNotifyUsesFinalNames(sql: string): boolean {
  const hasFinalTrigger = sql.includes(LIVE_QUERY_TRIGGER);
  const hasFinalChannel = sql.includes(LIVE_QUERY_CHANNEL);
  const stagingTrigger = `${VIEWS_STAGING}_live_query_notify`;
  return (
    hasFinalTrigger &&
    hasFinalChannel &&
    !sql.includes(stagingTrigger) &&
    !sql.includes(`'${VIEWS_STAGING}_live_query'`)
  );
}
