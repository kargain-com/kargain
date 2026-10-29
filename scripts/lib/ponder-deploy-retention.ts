/**
 * Sole owner of the Ponder deployment-schema retention set (ADR 0015 §h).
 * After a successful switch, drop every deployment schema except live, spare,
 * and pending. `kargain` is dropped by exact name once it is neither live nor
 * spare. Protected schemas are unreachable.
 */
import {
  DEPLOYMENT_SCHEMA_RE,
  LEGACY_SCHEMA,
  type PonderDeployState,
} from "./ponder-deploy-state.js";

export const PROTECTED_SCHEMAS = [
  "ponder_sync",
  "ponder_rpc_cache_1",
  "kargain_svm_raw",
  "kargain_svm_projection",
] as const;

export type RetentionKeepSet = {
  live: string | null;
  spare: string | null;
  pending: string | null;
};

/** The keep set as recorded in deploy state (executor reads it at execution). */
export function keepSetFromState(state: PonderDeployState): RetentionKeepSet {
  return {
    live: state.live?.schema ?? null,
    spare: state.spare?.schema ?? null,
    pending: state.pending?.schema ?? null,
  };
}

/**
 * From pg_namespace names, return schemas that must be dropped.
 * Never selects protected schemas. Never selects live/spare/pending.
 */
export function retentionSchemasToDrop(
  allSchemas: readonly string[],
  keep: RetentionKeepSet,
): string[] {
  const keepSet = new Set<string>();
  if (keep.live) keepSet.add(keep.live);
  if (keep.spare) keepSet.add(keep.spare);
  if (keep.pending) keepSet.add(keep.pending);

  const drop: string[] = [];
  for (const name of allSchemas) {
    if (PROTECTED_SCHEMAS.includes(name as (typeof PROTECTED_SCHEMAS)[number])) {
      continue;
    }
    const isDeploy = DEPLOYMENT_SCHEMA_RE.test(name);
    const isLegacy = name === LEGACY_SCHEMA;
    if (!isDeploy && !isLegacy) continue;
    if (keepSet.has(name)) continue;
    // kargain only when neither live nor spare (exact name).
    if (isLegacy && (keep.live === LEGACY_SCHEMA || keep.spare === LEGACY_SCHEMA)) {
      continue;
    }
    drop.push(name);
  }
  return drop.sort();
}

/** Negative control: would this name ever be selected for drop? */
export function retentionWouldSelect(name: string): boolean {
  if (PROTECTED_SCHEMAS.includes(name as (typeof PROTECTED_SCHEMAS)[number])) {
    return false;
  }
  return DEPLOYMENT_SCHEMA_RE.test(name) || name === LEGACY_SCHEMA;
}

/**
 * DROP SCHEMA SQL for one selected schema. Re-validates membership.
 */
export function dropDeploymentSchemaSql(
  schema: string,
  keep: RetentionKeepSet,
): string {
  if (PROTECTED_SCHEMAS.includes(schema as (typeof PROTECTED_SCHEMAS)[number])) {
    throw new Error(`deploy_retention_refused: protected schema ${schema}`);
  }
  if (!DEPLOYMENT_SCHEMA_RE.test(schema) && schema !== LEGACY_SCHEMA) {
    throw new Error(`deploy_retention_refused: invalid schema ${schema}`);
  }
  if (retentionSchemasToDrop([schema], keep).length === 0) {
    throw new Error(`deploy_retention_refused: schema in keep set ${schema}`);
  }
  return `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`;
}

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
