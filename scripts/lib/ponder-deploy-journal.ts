/**
 * Step journal that runs the deploy procedure from a host shell holding only
 * git, flock and docker (ADR 0016 §e).
 *
 * Each step process replays the procedure from the start against the journal.
 * Recorded effects return their recorded results (prints are not repeated).
 * The first unrecorded container effect runs and is recorded. The first
 * unrecorded host effect is recorded as pending and becomes the one-line
 * action the host executes; its status and output complete the entry on the
 * next step. The procedure keeps no state outside its world, so a replay
 * reaches the same point; a recorded effect that disagrees is a divergence.
 */
import type { PonderReadyMode, PonderReadyProbeResult } from "./ponder-readiness-probe.js";
import type {
  DeployObservation,
  DeployState,
  StateFileRead,
} from "./ponder-deploy-state.js";
import type {
  DeployOperation,
  DeployWorld,
  DeriveRequest,
} from "./ponder-deploy-switch.js";

export type HostResult = { status: number; output: string };

export type JournalEntry = {
  effect: string;
  args: string[];
  pending?: true;
  result?: unknown;
};

export type DeployJournal = {
  operation: DeployOperation;
  commit: string;
  repository: string;
  entries: JournalEntry[];
};

export class HostActionRequested extends Error {
  readonly action: string;

  constructor(action: string) {
    super(`host action: ${action}`);
    this.name = "HostActionRequested";
    this.action = action;
  }
}

export class JournalDivergence extends Error {
  constructor(detail: string) {
    super(`deploy_journal_divergence: ${detail}`);
    this.name = "JournalDivergence";
  }
}

/** Container-side effects; the host side is reached through actions. */
export type ContainerEffects = {
  write(line: string): void;
  readState(): Promise<StateFileRead>;
  writeState(state: DeployState): Promise<void>;
  identities(): Promise<{ indexing: string; executable: string }>;
  /** Runs the preflight, returning its exit code and the lines it printed. */
  preflight(): Promise<{ code: number; output: string }>;
  probe(mode: PonderReadyMode): Promise<PonderReadyProbeResult>;
  listSchemas(): Promise<string[]>;
  dropSchema(schema: string): Promise<void>;
  readBuildId(schema: string): Promise<string | null>;
};

export function completePendingEntry(
  journal: DeployJournal,
  result: HostResult,
): void {
  const last = journal.entries.at(-1);
  if (!last?.pending) throw new JournalDivergence("no_pending_host_action");
  delete last.pending;
  last.result = result;
}

const ARG_RE = /^[^\s]+$/;

function hostArgs(args: readonly string[]): string[] {
  for (const a of args) {
    if (!ARG_RE.test(a)) throw new JournalDivergence(`host_arg ${JSON.stringify(a)}`);
  }
  return [...args];
}

/** Parse the host `observe` output (see scripts/ponder-deploy.sh). */
export function parseObservation(
  output: string,
  images: readonly string[],
): DeployObservation {
  let container: { id: string; imageId: string; env: string[] } | null = null;
  const imageIds = new Map<string, string>();
  const imageEnv = new Map<string, string[]>();
  let legacyFile: string | null = null;
  for (const line of output.split("\n")) {
    if (line === "") continue;
    const sp = line.indexOf(" ");
    const tag = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? "" : line.slice(sp + 1);
    if (tag === "container") {
      const [id, imageId] = rest.split(" ");
      container = { id: id!, imageId: imageId!, env: [] };
    } else if (tag === "container_env") {
      if (!container) throw new JournalDivergence("observe_env_before_container");
      container.env.push(rest);
    } else if (tag === "image") {
      const [ref, id] = rest.split(" ");
      imageIds.set(ref!, id!);
    } else if (tag === "image_env") {
      const ref = rest.slice(0, rest.indexOf(" "));
      const env = imageEnv.get(ref) ?? [];
      env.push(rest.slice(ref.length + 1));
      imageEnv.set(ref, env);
    } else if (tag === "legacy_file") {
      legacyFile = rest;
    } else if (tag !== "container_missing" && tag !== "image_missing") {
      throw new JournalDivergence(`observe_line ${JSON.stringify(tag)}`);
    }
  }
  const schemaOf = (env: readonly string[]): string | null => {
    let schema: string | null = null;
    for (const kv of env) {
      if (kv.startsWith("DATABASE_SCHEMA=")) schema = kv.slice("DATABASE_SCHEMA=".length);
    }
    return schema;
  };
  const out: DeployObservation = {
    container: container
      ? { id: container.id, imageId: container.imageId, schema: schemaOf(container.env) }
      : null,
    images: {},
    legacyFile,
  };
  for (const ref of images) {
    const id = imageIds.get(ref);
    out.images[ref] = id
      ? { id, schema: schemaOf(imageEnv.get(ref) ?? []) }
      : null;
  }
  return out;
}

function requireOk(verb: string, r: HostResult): void {
  if (r.status !== 0) throw new JournalDivergence(`${verb}_status_${r.status}`);
}

export function createJournaledWorld(
  journal: DeployJournal,
  save: (journal: DeployJournal) => void,
  effects: ContainerEffects,
): DeployWorld {
  let cursor = 0;

  const recorded = (effect: string, args: string[]): JournalEntry | null => {
    if (cursor >= journal.entries.length) return null;
    const e = journal.entries[cursor]!;
    if (e.effect !== effect || JSON.stringify(e.args) !== JSON.stringify(args)) {
      throw new JournalDivergence(
        `expected ${e.effect}(${e.args.join(",")}) got ${effect}(${args.join(",")})`,
      );
    }
    if (e.pending) throw new JournalDivergence(`pending_${effect}`);
    cursor += 1;
    return e;
  };

  async function container<T>(
    effect: string,
    args: string[],
    live: () => Promise<T>,
  ): Promise<T> {
    const e = recorded(effect, args);
    if (e) return e.result as T;
    const result = await live();
    journal.entries.push({ effect, args, result: result ?? null });
    save(journal);
    cursor += 1;
    return result;
  }

  async function host<T>(
    verb: string,
    rawArgs: readonly string[],
    parse: (r: HostResult) => T,
  ): Promise<T> {
    const args = hostArgs(rawArgs);
    const e = recorded(verb, args);
    if (e) return parse(e.result as HostResult);
    journal.entries.push({ effect: verb, args, pending: true });
    save(journal);
    throw new HostActionRequested([verb, ...args].join(" "));
  }

  return {
    print: (line) =>
      container("print", [line], async () => {
        effects.write(`${line}\n`);
        return null;
      }).then(() => undefined),
    readState: () => container("read_state", [], () => effects.readState()),
    writeState: (state) =>
      container("write_state", [JSON.stringify(state)], async () => {
        await effects.writeState(state);
        return null;
      }).then(() => undefined),
    identities: () => container("identities", [], () => effects.identities()),
    preflight: () =>
      container("preflight", [], async () => {
        const r = await effects.preflight();
        effects.write(r.output);
        return r.code;
      }),
    probe: (mode) => container("probe", [mode], () => effects.probe(mode)),
    listSchemas: () => container("list_schemas", [], () => effects.listSchemas()),
    dropSchema: (schema) =>
      container("drop_schema", [schema], async () => {
        await effects.dropSchema(schema);
        return null;
      }).then(() => undefined),
    readBuildId: (schema) =>
      container("read_build_id", [schema], () => effects.readBuildId(schema)),

    observe: (images) =>
      host("observe", images, (r) => {
        requireOk("observe", r);
        return parseObservation(r.output, images);
      }),
    derive: (req: DeriveRequest) =>
      host(
        "derive",
        [
          req.source,
          req.tag,
          req.schema,
          req.commit ?? "legacy",
          req.indexing ?? "none",
          req.executable,
        ],
        (r) => requireOk("derive", r),
      ),
    tagWriter: (image) => host("tag", [image], (r) => requireOk("tag", r)),
    recreate: () => host("recreate", [], (r) => requireOk("recreate", r)),
    writerNodeVersion: () =>
      host("node", [], (r) => {
        const v = r.output.trim();
        return r.status === 0 && v !== "" ? v : null;
      }),
    listRepositoryTags: () =>
      host("tags", [], (r) => {
        requireOk("tags", r);
        return r.output
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l !== "" && l !== "<none>");
      }),
    removeImageTag: (image) => host("rmi", [image], (r) => requireOk("rmi", r)),
    pruneImages: () => host("prune", [], (r) => requireOk("prune", r)),
    deleteLegacyFile: () =>
      host("delete_legacy_file", [], (r) => requireOk("delete_legacy_file", r)),
  };
}
