/**
 * Sole owner of Ponder deploy retention selection (ADR 0016 §j).
 *
 * Only owned names are ever selected: schemas named `k_<40 hex>` or exactly
 * `kargain`, and tags of the writer image repository. `public`,
 * `ponder_sync`, `ponder_rpc_cache_1`, `kargain_svm_raw` and
 * `kargain_svm_projection` cannot match (ADR 0011: the sync store and RPC
 * cache are never dropped). `ponder db prune` is not used: it drops every
 * schema without a live lock, a stopped previous writer included.
 */
import {
  DEPLOY_IMAGE_TAG,
  LEGACY_SCHEMA,
  refSchema,
  WRITER_IMAGE_TAG,
  type DeployState,
} from "./ponder-deploy-state.js";

const OWNED_SCHEMA_RE = /^k_[0-9a-f]{40}$/;

export function isOwnedPonderSchema(name: string): boolean {
  return OWNED_SCHEMA_RE.test(name) || name === LEGACY_SCHEMA;
}

/** Owned schemas that are neither `current`'s nor `previous`'s. */
export function schemasToDrop(
  schemas: readonly string[],
  state: Pick<DeployState, "current" | "previous">,
): string[] {
  const keep = new Set<string>([refSchema(state.current)]);
  if (state.previous) keep.add(refSchema(state.previous));
  return schemas.filter((s) => isOwnedPonderSchema(s) && !keep.has(s)).sort();
}

function tagOf(image: string, repository: string): string {
  return image.slice(repository.length + 1);
}

/**
 * Tags of `repository` to remove: every one except `current`'s, `previous`'s,
 * `writer` and `deploy`.
 */
export function imageTagsToRemove(
  tags: readonly string[],
  state: Pick<DeployState, "current" | "previous">,
  repository: string,
): string[] {
  const keep = new Set<string>([
    WRITER_IMAGE_TAG,
    DEPLOY_IMAGE_TAG,
    tagOf(state.current.image, repository),
  ]);
  if (state.previous) keep.add(tagOf(state.previous.image, repository));
  return [...new Set(tags)].filter((t) => !keep.has(t)).sort();
}

/** SQL for one owned schema; refuses any name retention could not select. */
export function dropSchemaSql(name: string): string {
  if (!isOwnedPonderSchema(name)) {
    throw new Error(`retention refuses non-owned schema ${JSON.stringify(name)}`);
  }
  return `DROP SCHEMA "${name}" CASCADE`;
}
