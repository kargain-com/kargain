/**
 * Sole owner of the Ponder deployment-schema retention set (ADR 0014 §f / #69).
 * Drops only names matching ^k_[0-9a-f]{40}$ that are not live, previous, or pending.
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
};

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
 * and optional non-membership in keep (B6). Never emits for unprotected names.
 */
export function dropDeploymentSchemaSql(
  schema: string,
  keep?: RetentionKeepSet,
): string {
  if (!DEPLOYMENT_SCHEMA_RE.test(schema)) {
    throw new Error(`deploy_retention_refused: invalid schema ${schema}`);
  }
  if (keep) {
    const stillKeep = retentionSchemasToDrop([schema], keep);
    if (stillKeep.length === 0) {
      throw new Error(`deploy_retention_refused: schema in keep set ${schema}`);
    }
  }
  return `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`;
}

/** Emit DROP statements for a list already selected by retentionSchemasToDrop. */
export function retentionDropSql(schemas: readonly string[]): string {
  const lines: string[] = [];
  for (const schema of schemas) {
    lines.push(dropDeploymentSchemaSql(schema));
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
