/**
 * Sole owner of the Ponder deploy state file (ADR 0015 §i).
 * Fail-closed: unknown fields or bad shapes refuse as deploy_state_invalid.
 * Imports only Node builtins — runnable from a host-mounted scripts/ tree.
 *
 * Pre-cutover is observed (Compose service `ponder` is the legacy writer, not
 * the pinned nginx image). The pre-cutover file shape `{identity, executable}`
 * is accepted only while that observation holds; the first write replaces it.
 */
import { readFileSync, writeFileSync } from "node:fs";

export const DEPLOY_STATE_INVALID = "deploy_state_invalid";

/** Deployment schema: k_<40-hex>, or exactly `kargain` (legacy). */
export const DEPLOYMENT_SCHEMA_RE = /^k_[0-9a-f]{40}$/;
export const LEGACY_SCHEMA = "kargain";

export type PonderDeploySlot = "blue" | "green";

export type PonderLiveOrPendingRef = {
  slot: PonderDeploySlot;
  schema: string;
  commit: string;
  executable: string;
  image: string;
};

/** Spare has no slot; commit is null only for the legacy spare on schema kargain. */
export type PonderSpareRef = {
  schema: string;
  commit: string | null;
  executable: string;
  image: string;
};

export type PonderDeployState = {
  live: PonderLiveOrPendingRef | null;
  spare: PonderSpareRef | null;
  pending: PonderLiveOrPendingRef | null;
  nginx_config_digest: string | null;
};

/** Pre-cutover file on today's production (identity + executable only). */
export type PonderPreCutoverState = {
  identity: string;
  executable: string;
};

export type LoadedDeployState =
  | { kind: "post_cutover"; state: PonderDeployState }
  | { kind: "pre_cutover"; state: PonderPreCutoverState };

export class DeployStateInvalidError extends Error {
  readonly code = DEPLOY_STATE_INVALID;
  constructor(detail: string) {
    super(`${DEPLOY_STATE_INVALID}: ${detail}`);
    this.name = "DeployStateInvalidError";
  }
}

const COMMIT_RE = /^[0-9a-f]{40}$/;
const POST_KEYS = new Set([
  "live",
  "spare",
  "pending",
  "nginx_config_digest",
]);
const PRE_KEYS = new Set(["identity", "executable"]);

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DeployStateInvalidError(`${field} must be a non-empty string`);
  }
  return value;
}

export function assertDeploymentSchema(value: unknown, field: string): string {
  const s = assertString(value, field);
  if (s === LEGACY_SCHEMA) return s;
  if (!DEPLOYMENT_SCHEMA_RE.test(s)) {
    throw new DeployStateInvalidError(
      `${field} must match k_<40-hex> or be exactly kargain`,
    );
  }
  return s;
}

function assertCommit(value: unknown, field: string): string {
  const s = assertString(value, field).toLowerCase();
  if (!COMMIT_RE.test(s)) {
    throw new DeployStateInvalidError(`${field} must be 40 lowercase hex`);
  }
  return s;
}

function parseLiveOrPending(
  value: unknown,
  field: string,
): PonderLiveOrPendingRef {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DeployStateInvalidError(`${field} must be an object`);
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (
      key !== "slot" &&
      key !== "schema" &&
      key !== "commit" &&
      key !== "executable" &&
      key !== "image"
    ) {
      throw new DeployStateInvalidError(`${field} unknown field ${key}`);
    }
  }
  const slot = assertString(obj.slot, `${field}.slot`);
  if (slot !== "blue" && slot !== "green") {
    throw new DeployStateInvalidError(`${field}.slot must be blue|green`);
  }
  return {
    slot,
    schema: assertDeploymentSchema(obj.schema, `${field}.schema`),
    commit: assertCommit(obj.commit, `${field}.commit`),
    executable: assertString(obj.executable, `${field}.executable`),
    image: assertString(obj.image, `${field}.image`),
  };
}

function parseNullableLiveOrPending(
  value: unknown,
  field: string,
): PonderLiveOrPendingRef | null {
  if (value === null || value === undefined) return null;
  return parseLiveOrPending(value, field);
}

function parseSpare(value: unknown): PonderSpareRef | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DeployStateInvalidError("spare must be an object or null");
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (
      key !== "schema" &&
      key !== "commit" &&
      key !== "executable" &&
      key !== "image"
    ) {
      throw new DeployStateInvalidError(`spare unknown field ${key}`);
    }
  }
  const schema = assertDeploymentSchema(obj.schema, "spare.schema");
  let commit: string | null;
  if (obj.commit === null) {
    if (schema !== LEGACY_SCHEMA) {
      throw new DeployStateInvalidError(
        "spare.commit null only allowed when spare.schema is kargain",
      );
    }
    commit = null;
  } else {
    commit = assertCommit(obj.commit, "spare.commit");
  }
  return {
    schema,
    commit,
    executable: assertString(obj.executable, "spare.executable"),
    image: assertString(obj.image, "spare.image"),
  };
}

function assertDistinctRefs(state: PonderDeployState): void {
  const slots = [state.live, state.pending]
    .filter((r): r is PonderLiveOrPendingRef => r != null)
    .map((r) => r.slot);
  if (new Set(slots).size !== slots.length) {
    throw new DeployStateInvalidError("live/pending slots must be distinct");
  }
  const schemas: string[] = [];
  if (state.live) schemas.push(state.live.schema);
  if (state.pending) schemas.push(state.pending.schema);
  if (state.spare) schemas.push(state.spare.schema);
  if (new Set(schemas).size !== schemas.length) {
    throw new DeployStateInvalidError(
      "live/spare/pending schemas must be distinct",
    );
  }
}

export function parsePostCutoverState(raw: unknown): PonderDeployState {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DeployStateInvalidError("state must be an object");
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!POST_KEYS.has(key)) {
      throw new DeployStateInvalidError(`unknown field ${key}`);
    }
  }
  for (const key of POST_KEYS) {
    if (!(key in obj)) {
      throw new DeployStateInvalidError(`missing field ${key}`);
    }
  }
  const state: PonderDeployState = {
    live: parseNullableLiveOrPending(obj.live, "live"),
    spare: parseSpare(obj.spare),
    pending: parseNullableLiveOrPending(obj.pending, "pending"),
    nginx_config_digest:
      obj.nginx_config_digest === null
        ? null
        : assertString(obj.nginx_config_digest, "nginx_config_digest"),
  };
  assertDistinctRefs(state);
  return state;
}

export function parsePreCutoverState(raw: unknown): PonderPreCutoverState {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DeployStateInvalidError("state must be an object");
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!PRE_KEYS.has(key)) {
      throw new DeployStateInvalidError(`unknown field ${key}`);
    }
  }
  for (const key of PRE_KEYS) {
    if (!(key in obj)) {
      throw new DeployStateInvalidError(`missing field ${key}`);
    }
  }
  return {
    identity: assertString(obj.identity, "identity"),
    executable: assertString(obj.executable, "executable"),
  };
}

/**
 * Load state from disk. `preCutoverObserved` must reflect the live observation
 * (ponder service is legacy writer). Pre-cutover shape refused after cutover.
 */
export function loadDeployState(
  path: string,
  preCutoverObserved: boolean,
): LoadedDeployState {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "read";
    throw new DeployStateInvalidError(`unreadable file (${code})`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new DeployStateInvalidError("unreadable JSON");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DeployStateInvalidError("state must be an object");
  }
  const keys = Object.keys(raw as object);
  const looksPre = keys.every((k) => PRE_KEYS.has(k)) && keys.length > 0;
  const looksPost = keys.some((k) => POST_KEYS.has(k));

  if (looksPre && !looksPost) {
    if (!preCutoverObserved) {
      throw new DeployStateInvalidError(
        "pre_cutover file shape while post-cutover observed",
      );
    }
    return { kind: "pre_cutover", state: parsePreCutoverState(raw) };
  }
  return { kind: "post_cutover", state: parsePostCutoverState(raw) };
}

export function writeDeployState(
  path: string,
  state: PonderDeployState,
): void {
  assertDistinctRefs(state);
  const body = `${JSON.stringify(state, null, 2)}\n`;
  writeFileSync(path, body, "utf8");
}

export function emptyPostCutoverState(): PonderDeployState {
  return {
    live: null,
    spare: null,
    pending: null,
    nginx_config_digest: null,
  };
}

/** Schema name for a deploy commit (ADR §a). */
export function schemaForCommit(commit: string): string {
  const c = assertCommit(commit, "commit");
  return `k_${c}`;
}

export function freeSlot(live: PonderLiveOrPendingRef | null): PonderDeploySlot {
  if (live === null || live.slot === "green") return "blue";
  return "green";
}
