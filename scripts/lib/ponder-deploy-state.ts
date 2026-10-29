/**
 * Sole owner of the Ponder deploy state file (ADR 0014 / issue #69).
 * Fail-closed: unknown fields or bad shapes refuse as deploy_state_invalid.
 * Imports only Node builtins — runnable from a host-mounted scripts/ tree.
 *
 * Phase (pre- vs post-cutover) is a database fact (A1): schema `kargain` holds
 * base tables (relkind r|p) before cutover, views only after. The file never
 * stores a preCutover flag.
 */
import { readFileSync, writeFileSync } from "node:fs";

export const DEPLOY_STATE_INVALID = "deploy_state_invalid";

export type PonderDeploySlot = "blue" | "green";

/** Every slot ref records the commit + executable of the code that slot runs (A6). */
export type PonderSlotRef = {
  slot: PonderDeploySlot;
  schema: string;
  commit: string;
  executable: string;
};

export type PonderRollbackModel = "keep_previous" | "restart_previous";

export type PonderLagBound = {
  l_single_max: number;
  m: number;
  b: number;
};

export type DeployPhase = "pre_cutover" | "post_cutover";

/** Runtime state (phase from DB observation, never persisted as a flag). */
export type PonderDeployState = {
  identity: string;
  executable: string;
  live: PonderSlotRef | null;
  previous: PonderSlotRef | null;
  pending: PonderSlotRef | null;
  rollback_model: PonderRollbackModel | null;
  lag: PonderLagBound | null;
  legacy_schema: string | null;
  /** Docker image id tagged for first-cutover rollback (A8). */
  legacy_image: string | null;
  /** Digest of ops/nginx/ponder.conf when proxy was last created (B9). */
  nginx_config_digest: string | null;
  /** Derived from DB observation via reconcileDeployPhase. */
  phase: DeployPhase;
};

export class DeployStateInvalidError extends Error {
  readonly code = DEPLOY_STATE_INVALID;
  constructor(detail: string) {
    super(`${DEPLOY_STATE_INVALID}: ${detail}`);
    this.name = "DeployStateInvalidError";
  }
}

const SCHEMA_RE = /^k_[0-9a-f]{40}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const KNOWN_KEYS = new Set([
  "identity",
  "executable",
  "live",
  "previous",
  "pending",
  "rollback_model",
  "lag",
  "legacy_schema",
  "legacy_image",
  "nginx_config_digest",
]);

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DeployStateInvalidError(`${field} must be a non-empty string`);
  }
  return value;
}

function assertDeploymentSchema(value: unknown, field: string): string {
  const s = assertString(value, field);
  if (!SCHEMA_RE.test(s)) {
    throw new DeployStateInvalidError(`${field} must match k_<40-hex>`);
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

function parseSlotRef(value: unknown, field: string): PonderSlotRef {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DeployStateInvalidError(`${field} must be an object`);
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (
      key !== "slot" &&
      key !== "schema" &&
      key !== "commit" &&
      key !== "executable"
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
  };
}

function parseNullableSlotRef(
  value: unknown,
  field: string,
): PonderSlotRef | null {
  if (value === null || value === undefined) return null;
  return parseSlotRef(value, field);
}

function parseLag(value: unknown): PonderLagBound | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DeployStateInvalidError("lag must be an object or null");
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== "l_single_max" && key !== "m" && key !== "b") {
      throw new DeployStateInvalidError(`lag unknown field ${key}`);
    }
  }
  for (const key of ["l_single_max", "m", "b"] as const) {
    if (typeof obj[key] !== "number" || !Number.isFinite(obj[key])) {
      throw new DeployStateInvalidError(`lag.${key} must be a finite number`);
    }
  }
  return {
    l_single_max: obj.l_single_max as number,
    m: obj.m as number,
    b: obj.b as number,
  };
}

/**
 * SQL: true when schema kargain holds at least one base table (relkind r|p).
 * Used by the executor to observe phase (A1).
 */
export const KARGAIN_HAS_BASE_TABLES_SQL = `
SELECT EXISTS (
  SELECT 1
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'kargain'
    AND c.relkind IN ('r', 'p')
) AS has_base;
`.trim();

/** Parse file JSON without phase. Caller must reconcile with DB observation. */
export function parsePonderDeployStateFile(raw: unknown): Omit<
  PonderDeployState,
  "phase"
> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DeployStateInvalidError("root must be an object");
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new DeployStateInvalidError(`unknown field ${key}`);
    }
  }
  const identity = assertString(obj.identity, "identity");
  const executable = assertString(obj.executable, "executable");

  let rollback_model: PonderRollbackModel | null = null;
  if (obj.rollback_model !== undefined && obj.rollback_model !== null) {
    if (
      obj.rollback_model !== "keep_previous" &&
      obj.rollback_model !== "restart_previous"
    ) {
      throw new DeployStateInvalidError(
        "rollback_model must be keep_previous|restart_previous|null",
      );
    }
    rollback_model = obj.rollback_model;
  }

  let legacy_schema: string | null = null;
  if (obj.legacy_schema !== undefined && obj.legacy_schema !== null) {
    legacy_schema = assertDeploymentSchema(obj.legacy_schema, "legacy_schema");
  }

  let legacy_image: string | null = null;
  if (obj.legacy_image !== undefined && obj.legacy_image !== null) {
    legacy_image = assertString(obj.legacy_image, "legacy_image");
  }

  let nginx_config_digest: string | null = null;
  if (
    obj.nginx_config_digest !== undefined &&
    obj.nginx_config_digest !== null
  ) {
    nginx_config_digest = assertString(
      obj.nginx_config_digest,
      "nginx_config_digest",
    );
  }

  const live = parseNullableSlotRef(obj.live ?? null, "live");
  const previous = parseNullableSlotRef(obj.previous ?? null, "previous");
  const pending = parseNullableSlotRef(obj.pending ?? null, "pending");

  // B5: live / previous / pending must use distinct slots and schemas when set
  const slots = [live, previous, pending]
    .filter((r): r is PonderSlotRef => r !== null)
    .map((r) => r.slot);
  const schemas = [live, previous, pending]
    .filter((r): r is PonderSlotRef => r !== null)
    .map((r) => r.schema);
  if (new Set(slots).size !== slots.length) {
    throw new DeployStateInvalidError("live/previous/pending slots must be distinct");
  }
  if (new Set(schemas).size !== schemas.length) {
    throw new DeployStateInvalidError(
      "live/previous/pending schemas must be distinct",
    );
  }

  return {
    identity,
    executable,
    live,
    previous,
    pending,
    rollback_model,
    lag: parseLag(obj.lag ?? null),
    legacy_schema,
    legacy_image,
    nginx_config_digest,
  };
}

/**
 * Bind file state to the observed DB phase (A1). Disagreement refuses.
 */
export function reconcileDeployPhase(
  file: Omit<PonderDeployState, "phase">,
  kargainHasBaseTables: boolean,
): PonderDeployState {
  const phase: DeployPhase = kargainHasBaseTables
    ? "pre_cutover"
    : "post_cutover";

  if (phase === "pre_cutover" && file.live !== null) {
    throw new DeployStateInvalidError(
      "phase_mismatch: kargain has base tables but state.live is set",
    );
  }
  if (phase === "post_cutover" && file.live === null) {
    throw new DeployStateInvalidError(
      "phase_mismatch: kargain has no base tables but state.live is null",
    );
  }
  return { ...file, phase };
}

export function readPonderDeployStateFile(path: string): Omit<
  PonderDeployState,
  "phase"
> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new DeployStateInvalidError(
      `cannot read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DeployStateInvalidError("JSON parse failed");
  }
  return parsePonderDeployStateFile(raw);
}

/** Serializable shape written to disk (no phase flag). */
export type PonderDeployStateFile = {
  identity: string;
  executable: string;
  live: PonderSlotRef | null;
  previous: PonderSlotRef | null;
  pending: PonderSlotRef | null;
  rollback_model: PonderRollbackModel | null;
  lag: PonderLagBound | null;
  legacy_schema: string | null;
  legacy_image: string | null;
  nginx_config_digest: string | null;
};

export function toPonderDeployStateFile(
  state: PonderDeployState,
): PonderDeployStateFile {
  return {
    identity: state.identity,
    executable: state.executable,
    live: state.live,
    previous: state.previous,
    pending: state.pending,
    rollback_model: state.rollback_model,
    lag: state.lag,
    legacy_schema: state.legacy_schema,
    legacy_image: state.legacy_image,
    nginx_config_digest: state.nginx_config_digest,
  };
}

export function writePonderDeployStateFile(
  path: string,
  state: PonderDeployState | Omit<PonderDeployState, "phase">,
): void {
  const body: PonderDeployStateFile = {
    identity: state.identity,
    executable: state.executable,
    live: state.live,
    previous: state.previous,
    pending: state.pending,
    rollback_model: state.rollback_model,
    lag: state.lag,
    legacy_schema: state.legacy_schema,
    legacy_image: state.legacy_image,
    nginx_config_digest: state.nginx_config_digest,
  };
  writeFileSync(path, `${JSON.stringify(body)}\n`, "utf8");
}

export function schemaNameForDeploySha(deploySha: string): string {
  const sha = deploySha.trim().toLowerCase();
  if (!COMMIT_RE.test(sha)) {
    throw new DeployStateInvalidError(
      "deploySha must be 40 lowercase hex characters",
    );
  }
  return `k_${sha}`;
}

export function isDeploymentSchemaName(name: string): boolean {
  return SCHEMA_RE.test(name);
}

/** @deprecated use parsePonderDeployStateFile + reconcileDeployPhase */
export function parsePonderDeployState(
  raw: unknown,
  opts?: { kargainHasBaseTables?: boolean },
): PonderDeployState {
  const file = parsePonderDeployStateFile(raw);
  const hasBase =
    opts?.kargainHasBaseTables ??
    (file.live === null && file.pending === null ? true : file.live === null);
  // When caller omits observation: fingerprints-only → pre; live set → post.
  const inferred =
    opts?.kargainHasBaseTables !== undefined
      ? opts.kargainHasBaseTables
      : file.live === null;
  return reconcileDeployPhase(file, inferred);
}

export { SCHEMA_RE as DEPLOYMENT_SCHEMA_RE };
