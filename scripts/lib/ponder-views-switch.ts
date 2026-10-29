/**
 * Sole owner of the atomic Ponder views-switch SQL (ADR 0014 §b / #69).
 * Generates one script for `psql --single-transaction -v ON_ERROR_STOP=1`.
 * Notify channel/trigger use the final views-schema names (kargain_*), never the
 * staging schema string.
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

export type ViewsSwitchKind = "normal" | "first_cutover";

export type ViewsSwitchInput = {
  /** Deployment schema the views should point at (k_<sha>). */
  targetSchema: string;
  kind: ViewsSwitchKind;
  /**
   * First cutover: rename table schema `kargain` to this recorded name.
   * Normal: rename views schema `kargain` to kargain_views_prev then drop if empty.
   */
  renameLiveTo: string;
  /** App table + view names from _ponder_meta (excluding meta/checkpoint). */
  tableNames: readonly string[];
  viewNames: readonly string[];
};

function qIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function createViewSql(staging: string, target: string, name: string): string {
  return `CREATE VIEW ${qIdent(staging)}.${qIdent(name)} AS SELECT * FROM ${qIdent(target)}.${qIdent(name)};`;
}

/** Live-query notify procedure with the final channel name. */
export function liveQueryNotifyProcedureSql(schema: string): string {
  return `
CREATE OR REPLACE FUNCTION ${qIdent(schema)}.${LIVE_QUERY_PROCEDURE}
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
        PERFORM pg_notify('${LIVE_QUERY_CHANNEL}', current_payload || ']');
        current_payload := '[' || entry_json;
        separator := ',';
      ELSE
        current_payload := current_payload || separator || entry_json;
        separator := ',';
      END IF;
    END LOOP;

    IF current_payload = '[' THEN
      PERFORM pg_notify('${LIVE_QUERY_CHANNEL}', '[]');
    ELSE
      PERFORM pg_notify('${LIVE_QUERY_CHANNEL}', current_payload || ']');
    END IF;

    DELETE FROM live_query_tables;
    RETURN NULL;
  END;
$$;
`.trim();
}

/**
 * Read-only query that lists app table_names and view_names from _ponder_meta.
 * The executor runs this first, then calls generateViewsSwitchSql.
 */
export function readPonderMetaNamesSql(deploymentSchema: string): string {
  return `
SELECT
  COALESCE((value->'app'->'table_names'), '[]'::jsonb) AS table_names,
  COALESCE((value->'app'->'view_names'), '[]'::jsonb) AS view_names
FROM ${qIdent(deploymentSchema)}.${qIdent(PONDER_META)}
WHERE key = 'app'
LIMIT 1;
`.trim();
}

/**
 * One transactional script. Requires --single-transaction.
 * Aborts by name if kargain_views_prev would hold base tables (normal path).
 */
export function generateViewsSwitchSql(input: ViewsSwitchInput): string {
  const { targetSchema, kind, renameLiveTo, tableNames, viewNames } = input;
  const lines: string[] = [];
  lines.push(`-- ponder-views-switch target=${targetSchema} kind=${kind}`);
  lines.push(`CREATE SCHEMA ${qIdent(VIEWS_STAGING)};`);

  for (const t of tableNames) {
    lines.push(createViewSql(VIEWS_STAGING, targetSchema, t));
  }
  for (const v of viewNames) {
    lines.push(createViewSql(VIEWS_STAGING, targetSchema, v));
  }
  lines.push(createViewSql(VIEWS_STAGING, targetSchema, PONDER_META));
  lines.push(createViewSql(VIEWS_STAGING, targetSchema, PONDER_CHECKPOINT));

  lines.push(liveQueryNotifyProcedureSql(VIEWS_STAGING));
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
    // Abort if previous held base tables (must be views-only).
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

/** Assert helper for policy: SQL must mention single-transaction args usage site. */
export function viewsSwitchRequiresSingleTransaction(invocation: string): boolean {
  return (
    invocation.includes("--single-transaction") &&
    invocation.includes("ON_ERROR_STOP=1")
  );
}

/** Assert helper: trigger must use final name, never staging-schema-derived. */
export function viewsSwitchNotifyUsesFinalNames(sql: string): boolean {
  const hasFinalTrigger = sql.includes(LIVE_QUERY_TRIGGER);
  const hasFinalChannel = sql.includes(LIVE_QUERY_CHANNEL);
  const stagingTrigger = `${VIEWS_STAGING}_live_query_notify`;
  const stagingChannel = `${VIEWS_STAGING}_live_query`;
  return (
    hasFinalTrigger &&
    hasFinalChannel &&
    !sql.includes(stagingTrigger) &&
    !sql.includes(`'${stagingChannel}'`)
  );
}
