/**
 * Sole owner of the Ponder deploy state `.ponder-deploy/state.json` (ADR 0016 §f).
 *
 * Shape `{current, previous, switching}`; a ref is
 * `{commit, image, indexing, executable}`. The legacy ref has `commit` and
 * `indexing` null and schema `kargain`; every other ref's schema is `k_` plus
 * the first 40 hex of `indexing`. The schema reaches the writer only through
 * its image's `ENV` — this file is never an env file.
 *
 * Fail-closed: any unknown, missing or malformed field, or refs that break the
 * sharing rule, is `deploy_state_invalid: <detail>`. Writes are
 * replace-on-rename.
 */
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type DeployRef = {
  commit: string | null;
  image: string;
  indexing: string | null;
  executable: string;
};

export type DeployState = {
  current: DeployRef;
  previous: DeployRef | null;
  switching: DeployRef | null;
};

export const LEGACY_SCHEMA = "kargain";
export const LEGACY_IMAGE_TAG = "legacy";
export const WRITER_IMAGE_TAG = "writer";
export const DEPLOY_IMAGE_TAG = "deploy";

const COMMIT_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const REF_KEYS = ["commit", "executable", "image", "indexing"] as const;
const STATE_KEYS = ["current", "previous", "switching"] as const;

/** Writer schema of a ref: `kargain` for legacy, else `k_<first 40 hex of indexing>`. */
export function refSchema(ref: DeployRef): string {
  if (ref.indexing === null) return LEGACY_SCHEMA;
  return `k_${ref.indexing.slice(0, 40)}`;
}

/** Image tag of a ref within a repository: `<repo>:legacy` or `<repo>:<commit>`. */
export function refImage(repository: string, commit: string | null): string {
  return `${repository}:${commit ?? LEGACY_IMAGE_TAG}`;
}

export function refLabel(ref: DeployRef): string {
  return ref.commit ?? "legacy";
}

export class DeployStateInvalid extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(`deploy_state_invalid: ${detail}`);
    this.name = "DeployStateInvalid";
    this.detail = detail;
  }
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
  where: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DeployStateInvalid(`${where}_not_object`);
  }
  const obj = value as Record<string, unknown>;
  const got = Object.keys(obj).sort();
  for (const key of got) {
    if (!keys.includes(key)) throw new DeployStateInvalid(`${where}_unknown_field_${key}`);
  }
  for (const key of keys) {
    if (!(key in obj)) throw new DeployStateInvalid(`${where}_missing_field_${key}`);
  }
  return obj;
}

function parseRef(value: unknown, where: string, repository: string): DeployRef {
  const obj = exactKeys(value, REF_KEYS, where);
  const { commit, image, indexing, executable } = obj;
  if (commit !== null && !(typeof commit === "string" && COMMIT_RE.test(commit))) {
    throw new DeployStateInvalid(`${where}_commit`);
  }
  if (indexing !== null && !(typeof indexing === "string" && DIGEST_RE.test(indexing))) {
    throw new DeployStateInvalid(`${where}_indexing`);
  }
  if (!(typeof executable === "string" && DIGEST_RE.test(executable))) {
    throw new DeployStateInvalid(`${where}_executable`);
  }
  if ((commit === null) !== (indexing === null)) {
    throw new DeployStateInvalid(`${where}_legacy_shape`);
  }
  if (image !== refImage(repository, commit)) {
    throw new DeployStateInvalid(`${where}_image`);
  }
  return { commit, image, indexing, executable };
}

/** Two refs may share a schema only if they share `indexing`. */
export function sharingRuleViolation(state: DeployState): string | null {
  const refs: [string, DeployRef][] = [["current", state.current]];
  if (state.previous) refs.push(["previous", state.previous]);
  if (state.switching) refs.push(["switching", state.switching]);
  for (let i = 0; i < refs.length; i++) {
    for (let j = i + 1; j < refs.length; j++) {
      const [na, a] = refs[i]!;
      const [nb, b] = refs[j]!;
      if (refSchema(a) === refSchema(b) && a.indexing !== b.indexing) {
        return `schema_shared_${na}_${nb}`;
      }
    }
  }
  return null;
}

/** Parse state text; throws {@link DeployStateInvalid} on any defect. */
export function parseDeployState(text: string, repository: string): DeployState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DeployStateInvalid("state_unparsable");
  }
  const obj = exactKeys(raw, STATE_KEYS, "state");
  const state: DeployState = {
    current: parseRef(obj.current, "current", repository),
    previous:
      obj.previous === null ? null : parseRef(obj.previous, "previous", repository),
    switching:
      obj.switching === null
        ? null
        : parseRef(obj.switching, "switching", repository),
  };
  const sharing = sharingRuleViolation(state);
  if (sharing) throw new DeployStateInvalid(sharing);
  return state;
}

export function serializeDeployState(state: DeployState): string {
  const ref = (r: DeployRef) => ({
    commit: r.commit,
    image: r.image,
    indexing: r.indexing,
    executable: r.executable,
  });
  return `${JSON.stringify(
    {
      current: ref(state.current),
      previous: state.previous ? ref(state.previous) : null,
      switching: state.switching ? ref(state.switching) : null,
    },
    null,
    2,
  )}\n`;
}

/** Replace-on-rename write in the target's directory (fsync before rename). */
export function writeFileReplacing(path: string, text: string): void {
  const tmp = join(dirname(path), `.${process.pid}.${Date.now()}.tmp`);
  const fd = openSync(tmp, "w", 0o644);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

export type StateFileRead =
  | { kind: "absent" }
  | { kind: "text"; text: string }
  | { kind: "unreadable" };

export function readStateFile(path: string): StateFileRead {
  try {
    return { kind: "text", text: readFileSync(path, "utf8") };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable" };
  }
}

/**
 * Executable digest recorded by the pre-ADR deploy file, the legacy ref's
 * `executable` (ADR 0016 §f step 3). Anything else is a named refusal.
 */
export function parseLegacyFingerprints(line: string): string {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new DeployStateInvalid("legacy_file_unparsable");
  }
  const executable =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).executable
      : undefined;
  if (!(typeof executable === "string" && DIGEST_RE.test(executable))) {
    throw new DeployStateInvalid("legacy_file_executable");
  }
  return executable;
}

/** Docker observation of the writer container and the images a run names. */
export type DeployObservation = {
  container: { id: string; imageId: string; schema: string | null } | null;
  images: Record<string, { id: string; schema: string | null } | null>;
  legacyFile: string | null;
};

/**
 * ADR 0016 §f observation, with `switching` null and before any mutation.
 * Returns the first disagreement as a detail, or null.
 */
export function observationDefect(
  state: DeployState,
  obs: DeployObservation,
  writerImage: string,
): string | null {
  const writer = obs.images[writerImage] ?? null;
  const current = obs.images[state.current.image] ?? null;
  if (!current) return "current_image_missing";
  if (state.previous && !(obs.images[state.previous.image] ?? null)) {
    return "previous_image_missing";
  }
  if (!writer) return "writer_tag_missing";
  if (!obs.container) return "writer_container_missing";
  if (writer.id !== current.id) return "writer_tag_moved";
  if (obs.container.imageId !== writer.id) return "writer_container_image";
  if (obs.container.schema !== writer.schema) return "schema_override";
  if (writer.schema !== refSchema(state.current)) return "schema_mismatch";
  return null;
}
