/**
 * Sole owner of the Ponder deploy state file (ADR 0014 / issue #69).
 * Fail-closed: unknown fields or bad shapes refuse as deploy_state_invalid.
 * Imports only Node builtins — runnable from a host-mounted scripts/ tree.
 */
import { readFileSync, writeFileSync } from "node:fs";

export const DEPLOY_STATE_INVALID = "deploy_state_invalid";

export type PonderDeploySlot = "blue" | "green";

export type PonderSlotRef = {
  slot: PonderDeploySlot;
  schema: string;
};

export type PonderRollbackModel = "keep_previous" | "restart_previous";

export type PonderLagBound = {
  l_single_max: number;
  m: number;
  b: number;
};

/** Full post-cutover state. */
export type PonderDeployState = {
  identity: string;
  executable: string;
  live: PonderSlotRef | null;
  previous: PonderSlotRef | null;
  pending: PonderSlotRef | null;
  rollback_model: PonderRollbackModel | null;
  lag: PonderLagBound | null;
  legacy_schema: string | null;
  /** True when the file held only identity/executable (today's shape). */
  preCutover: boolean;
};

export class DeployStateInvalidError extends Error {
  readonly code = DEPLOY_STATE_INVALID;
  constructor(detail: string) {
    super(`${DEPLOY_STATE_INVALID}: ${detail}`);
    this.name = "DeployStateInvalidError";
  }
}

const SCHEMA_RE = /^k_[0-9a-f]{40}$/;
const KNOWN_KEYS = new Set([
  "identity",
  "executable",
  "live",
  "previous",
  "pending",
  "rollback_model",
  "lag",
  "legacy_schema",
]);

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DeployStateInvalidError(`${field} must be a non-empty string`);
  }
  return value;
}

function assertSchema(value: unknown, field: string): string {
  const s = assertString(value, field);
  if (!SCHEMA_RE.test(s) && s !== "kargain") {
    // live may still name legacy `kargain` only before cutover completes; after
    // cutover all deployment schemas are k_<40-hex>. Allow kargain only as
    // legacy_schema target rename source, not as live schema field value.
    throw new DeployStateInvalidError(`${field} must match k_<40-hex>`);
  }
  return s;
}

function assertDeploymentSchema(value: unknown, field: string): string {
  const s = assertString(value, field);
  if (!SCHEMA_RE.test(s)) {
    throw new DeployStateInvalidError(`${field} must match k_<40-hex>`);
  }
  return s;
}

function parseSlotRef(value: unknown, field: string): PonderSlotRef {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DeployStateInvalidError(`${field} must be an object`);
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== "slot" && key !== "schema") {
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
 * Parse state JSON. A file with only identity/executable is pre-cutover.
 */
export function parsePonderDeployState(raw: unknown): PonderDeployState {
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

  const onlyFingerprints =
    obj.live === undefined &&
    obj.previous === undefined &&
    obj.pending === undefined &&
    obj.rollback_model === undefined &&
    obj.lag === undefined &&
    obj.legacy_schema === undefined;

  if (onlyFingerprints) {
    return {
      identity,
      executable,
      live: null,
      previous: null,
      pending: null,
      rollback_model: null,
      lag: null,
      legacy_schema: null,
      preCutover: true,
    };
  }

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

  return {
    identity,
    executable,
    live: parseNullableSlotRef(obj.live ?? null, "live"),
    previous: parseNullableSlotRef(obj.previous ?? null, "previous"),
    pending: parseNullableSlotRef(obj.pending ?? null, "pending"),
    rollback_model,
    lag: parseLag(obj.lag ?? null),
    legacy_schema,
    preCutover: false,
  };
}

export function readPonderDeployStateFile(path: string): PonderDeployState {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new DeployStateInvalidError(
      `cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DeployStateInvalidError("JSON parse failed");
  }
  return parsePonderDeployState(raw);
}

/** Serializable shape written to disk (no preCutover flag). */
export type PonderDeployStateFile = {
  identity: string;
  executable: string;
  live: PonderSlotRef | null;
  previous: PonderSlotRef | null;
  pending: PonderSlotRef | null;
  rollback_model: PonderRollbackModel | null;
  lag: PonderLagBound | null;
  legacy_schema: string | null;
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
  };
}

export function writePonderDeployStateFile(
  path: string,
  state: PonderDeployState,
): void {
  const body = toPonderDeployStateFile(state);
  writeFileSync(path, `${JSON.stringify(body)}\n`, "utf8");
}

/** Schema name for a deploy SHA (ADR 0014 §a). */
export function schemaNameForDeploySha(deploySha: string): string {
  const sha = deploySha.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new DeployStateInvalidError(
      "deploySha must be 40 lowercase hex characters",
    );
  }
  return `k_${sha}`;
}

export function isDeploymentSchemaName(name: string): boolean {
  return SCHEMA_RE.test(name);
}

export { SCHEMA_RE as DEPLOYMENT_SCHEMA_RE };
