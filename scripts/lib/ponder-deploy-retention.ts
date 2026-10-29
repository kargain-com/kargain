/**
 * Sole owner of the Ponder deployment-schema retention set (ADR 0014 §f / #69).
 * Drops only names matching ^k_[0-9a-f]{40}$ that are not live, previous, pending, or the
 * first-cutover legacy spare.
 * Protected Context §6 schemas are unreachable via the regex.
 * DROP SQL is emitted only after re-validating the name (B6).
 */
import { DEPLOYMENT_SCHEMA_RE } from "./ponder-deploy-state.js";

export const PROTECTED_SCHEMAS = [
  "ponder_sync",
  "ponder_rpc_cache_1",
  "kargain_svm_raw",
  "kargain_svm_projection",
] as const;

export type RetentionKeepSet = {
  live: string | null;
  previous: string | null;
  pending: string | null;
  /**
   * First-cutover rollback spare (ADR §j). Kept while the first-cutover rollback is
   * valid, i.e. while state.legacy_schema is set (R12).
   */
  legacy: string | null;
};

/** The keep set as recorded in a deploy state (executor reads it at execution, R9). */
export function keepSetFromState(state: {
  live: { schema: string } | null;
  previous: { schema: string } | null;
  pending: { schema: string } | null;
  legacy_schema: string | null;
}): RetentionKeepSet {
  return {
    live: state.live?.schema ?? null,
    previous: state.previous?.schema ?? null,
    pending: state.pending?.schema ?? null,
    legacy: state.legacy_schema,
  };
}

/**
 * From a list of schema names (e.g. pg_namespace), return deployment schemas
 * that must be dropped. Never selects protected or non-matching names.
 */
export function retentionSchemasToDrop(
  allSchemas: readonly string[],
  keep: RetentionKeepSet,
): string[] {
  const keepSet = new Set<string>();
  if (keep.live) keepSet.add(keep.live);
  if (keep.previous) keepSet.add(keep.previous);
  if (keep.pending) keepSet.add(keep.pending);
  if (keep.legacy) keepSet.add(keep.legacy);

  const drop: string[] = [];
  for (const name of allSchemas) {
    if (!DEPLOYMENT_SCHEMA_RE.test(name)) continue;
    if (keepSet.has(name)) continue;
    drop.push(name);
  }
  return drop.sort();
}

/** Negative control helper: would this name ever be selected for drop? */
export function retentionWouldSelect(name: string): boolean {
  return DEPLOYMENT_SCHEMA_RE.test(name);
}

/**
 * Emit DROP SCHEMA SQL for one deployment schema. Re-validates ^k_[0-9a-f]{40}$
 * and non-membership in the keep set (B6 / R9 — keep is required: the executor passes
 * the set read from the state file at execution).
 */
export function dropDeploymentSchemaSql(
  schema: string,
  keep: RetentionKeepSet,
): string {
  if (!DEPLOYMENT_SCHEMA_RE.test(schema)) {
    throw new Error(`deploy_retention_refused: invalid schema ${schema}`);
  }
  if (retentionSchemasToDrop([schema], keep).length === 0) {
    throw new Error(`deploy_retention_refused: schema in keep set ${schema}`);
  }
  return `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`;
}

/** Emit DROP statements for a list already selected by retentionSchemasToDrop. */
export function retentionDropSql(
  schemas: readonly string[],
  keep: RetentionKeepSet,
): string {
  const lines: string[] = [];
  for (const schema of schemas) {
    lines.push(dropDeploymentSchemaSql(schema, keep));
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
