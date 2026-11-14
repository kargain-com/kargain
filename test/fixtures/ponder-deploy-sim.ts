/**
 * Simulated Docker + Ponder world for the ADR 0016 deploy procedure.
 *
 * Docker: content-addressed images, tags, one `ponder` container whose image
 * and effective DATABASE_SCHEMA are fixed at creation. Ponder: a start on a
 * schema it did not create with the same build_id is a MigrationError (no
 * answer); an absent schema is created; no DATABASE_SCHEMA or a build error
 * never answers. Every mutation can be followed by a crash, then a host
 * reboot (same container restarts) or a bare `docker compose up -d`.
 */
import { createHash } from "node:crypto";

import type {
  PonderReadyMode,
  PonderReadyProbeResult,
} from "../../scripts/lib/ponder-readiness-probe.ts";
import {
  serializeDeployState,
  type DeployObservation,
  type DeployState,
  type StateFileRead,
} from "../../scripts/lib/ponder-deploy-state.ts";
import type {
  DeployWorld,
  DeriveRequest,
} from "../../scripts/lib/ponder-deploy-switch.ts";

export const SIM_REPO = "kargain-ponder";
export const WRITER = `${SIM_REPO}:writer`;
export const DEPLOY = `${SIM_REPO}:deploy`;
export const PROTECTED_SCHEMAS = [
  "public",
  "ponder_sync",
  "ponder_rpc_cache_1",
  "kargain_svm_raw",
  "kargain_svm_projection",
];

export type Answers = "ready" | "catching" | "never";

export type SimCommit = {
  commit: string;
  indexing: string;
  executable: string;
  buildId: string;
  answers: Answers;
  /** Host `compose up` for this commit's writer image returns non-zero. */
  recreateFails?: boolean;
};

const hex = (seed: string, len: number) =>
  createHash("sha256").update(seed).digest("hex").slice(0, len);

function commitOf(
  name: string,
  indexing: string,
  executable: string,
  buildId: string,
  answers: Answers,
  recreateFails = false,
): SimCommit {
  return {
    commit: hex(`commit-${name}`, 40),
    indexing: hex(`indexing-${indexing}`, 64),
    executable: hex(`executable-${executable}`, 64),
    buildId: `build-${buildId}`,
    answers,
    ...(recreateFails ? { recreateFails: true } : {}),
  };
}

/**
 * c2 changes only the API (same indexing); c3 changes indexing yet keeps
 * c1's build_id; c4 never answers; c5's recreate fails on the host.
 */
export const SIM_COMMITS = {
  c1: commitOf("c1", "I1", "X1", "B1", "ready"),
  c2: commitOf("c2", "I1", "X2", "B1", "ready"),
  c3: commitOf("c3", "I2", "X3", "B1", "catching"),
  c4: commitOf("c4", "I4", "X4", "B4", "never"),
  c5: commitOf("c5", "I5", "X5", "B5", "ready", true),
} as const;

export const LEGACY_IDENTITY = "legacy";
export const LEGACY_EXECUTABLE = hex("executable-legacy", 64);

type Image = {
  identity: string;
  buildId: string;
  answers: Answers;
  schema: string | null;
  labels: string;
  recreateFails?: boolean;
};

type Container = {
  imageId: string;
  schema: string | null;
  /** Created by the post-ADR Compose file (no DATABASE_SCHEMA in environment). */
  newConfig: boolean;
  answering: boolean;
};

export type SimData = {
  images: Record<string, Image>;
  tags: Record<string, string>;
  container: Container | null;
  schemas: Record<string, { buildId: string; identity: string }>;
  stateFile: string | null;
  legacyFile: string | null;
  violations: string[];
  /** 1-based recreate call indexes that return non-zero without starting. */
  failRecreateCalls: number[];
  recreateCallCount: number;
};

export class SimCrash extends Error {
  constructor() {
    super("simulated crash");
    this.name = "SimCrash";
  }
}

const SIM_CRASH = new SimCrash();

const imageIds = new Map<string, string>();
function imageId(img: Image): string {
  const text = JSON.stringify(img);
  let id = imageIds.get(text);
  if (!id) {
    id = `sha256:${hex(text, 16)}`;
    imageIds.set(text, id);
  }
  return id;
}

/** Identity whose rows a schema name may hold. */
function schemaIdentity(name: string, data: SimData): string | null {
  if (name === "kargain") return LEGACY_IDENTITY;
  for (const c of Object.values(SIM_COMMITS)) {
    if (name === `k_${c.indexing.slice(0, 40)}`) return c.indexing;
  }
  void data;
  return null;
}

/** The pre-ADR world: compose-built image on `kargain`, the old deploy file. */
export function initialSimData(legacyAnswers: Answers): SimData {
  const old: Image = {
    identity: LEGACY_IDENTITY,
    buildId: "build-legacy",
    answers: legacyAnswers,
    schema: null,
    labels: "",
  };
  const oldId = imageId(old);
  return {
    images: { [oldId]: old },
    tags: { [`${SIM_REPO}:latest`]: oldId },
    container: {
      imageId: oldId,
      schema: "kargain",
      newConfig: false,
      answering: legacyAnswers !== "never",
    },
    schemas: { kargain: { buildId: "build-legacy", identity: LEGACY_IDENTITY } },
    stateFile: null,
    legacyFile: JSON.stringify({
      identity: hex("old-identity", 64),
      executable: LEGACY_EXECUTABLE,
    }),
    violations: [],
    failRecreateCalls: [],
    recreateCallCount: 0,
  };
}

function startContainer(
  data: SimData,
  id: string,
  schema: string | null,
  newConfig: boolean,
): void {
  const img = data.images[id];
  if (!img) throw new Error(`sim: no image ${id}`);
  let answering = false;
  if (schema !== null && img.answers !== "never") {
    const existing = data.schemas[schema];
    if (existing && existing.buildId !== img.buildId) {
      answering = false;
    } else {
      if (schemaIdentity(schema, data) !== img.identity) {
        data.violations.push(
          `identity ${img.identity.slice(0, 8)} wrote schema ${schema.slice(0, 10)}`,
        );
      }
      if (!existing) data.schemas[schema] = { buildId: img.buildId, identity: img.identity };
      answering = true;
    }
  }
  data.container = { imageId: id, schema, newConfig, answering };
}

export function simReboot(data: SimData): void {
  const c = data.container;
  if (c) startContainer(data, c.imageId, c.schema, c.newConfig);
}

/** Bare `docker compose up -d`: builds a missing writer from the working tree. */
export function simBareUp(data: SimData, checkedOut: SimCommit): void {
  let target = data.tags[WRITER];
  if (!target) {
    const built: Image = {
      identity: checkedOut.indexing,
      buildId: checkedOut.buildId,
      answers: checkedOut.answers,
      schema: null,
      labels: "",
      recreateFails: checkedOut.recreateFails === true,
    };
    target = imageId(built);
    data.images[target] = built;
    data.tags[WRITER] = target;
  }
  const c = data.container;
  if (!c || !c.newConfig || c.imageId !== target) {
    startContainer(data, target, data.images[target]!.schema, true);
  }
}

export type SimRun = {
  world: DeployWorld;
  lines: string[];
  mutations(): number;
};

/**
 * A run over `data` (mutated in place) for the checked-out commit. When
 * `crashAfter` is k, the k-th mutation applies and then throws {@link SimCrash}.
 * `snapshots`, when given, receives the world after every mutation: the
 * procedure is deterministic, so snapshot k is the world a crash after
 * mutation k leaves.
 */
export function simWorld(
  data: SimData,
  checkedOut: SimCommit,
  crashAfter: number | null,
  snapshots?: SimData[],
): SimRun {
  const lines: string[] = [];
  let mutations = 0;
  const mutate = (fn: () => void) => {
    fn();
    mutations += 1;
    snapshots?.push(cloneSim(data));
    if (crashAfter !== null && mutations === crashAfter) throw SIM_CRASH;
  };
  const resolve = (ref: string): string | undefined =>
    ref.startsWith("sha256:") ? (data.images[ref] ? ref : undefined) : data.tags[ref];

  const probe = async (mode: PonderReadyMode): Promise<PonderReadyProbeResult> => {
    const url = "http://ponder:42069/ready";
    const c = data.container;
    const answers = c?.answering ? data.images[c.imageId]!.answers : null;
    if (mode === "answered") {
      if (answers === null) {
        return { ok: false, mode, url, timeoutMs: 90_000, elapsedMs: 90_000, lastStatus: null };
      }
      return { ok: true, mode, status: answers === "ready" ? 200 : 503, url, elapsedMs: 1 };
    }
    if (answers === "ready") return { ok: true, mode, status: 200, url, elapsedMs: 1 };
    return {
      ok: false,
      mode,
      url,
      timeoutMs: 600_000,
      elapsedMs: 600_000,
      lastStatus: answers === null ? null : 503,
    };
  };

  const world: DeployWorld = {
    print: async (line) => {
      lines.push(line);
    },
    readState: async (): Promise<StateFileRead> =>
      data.stateFile === null ? { kind: "absent" } : { kind: "text", text: data.stateFile },
    writeState: async (state: DeployState) =>
      mutate(() => {
        data.stateFile = serializeDeployState(state);
      }),
    identities: async () => ({
      indexing: checkedOut.indexing,
      executable: checkedOut.executable,
    }),
    preflight: async () => 0,
    probe,
    listSchemas: async () => [...PROTECTED_SCHEMAS, ...Object.keys(data.schemas)],
    dropSchema: async (schema) =>
      mutate(() => {
        if (PROTECTED_SCHEMAS.includes(schema)) {
          data.violations.push(`dropped protected ${schema}`);
        }
        delete data.schemas[schema];
      }),
    readBuildId: async (schema) => data.schemas[schema]?.buildId ?? null,
    observe: async (images): Promise<DeployObservation> => {
      const out: DeployObservation = {
        container: data.container
          ? { id: "ponder-1", imageId: data.container.imageId, schema: data.container.schema }
          : null,
        images: {},
        legacyFile: data.legacyFile,
      };
      for (const ref of images) {
        const id = resolve(ref);
        out.images[ref] = id ? { id, schema: data.images[id]!.schema } : null;
      }
      return out;
    },
    derive: async (req: DeriveRequest) => {
      const sourceId = resolve(req.source);
      if (!sourceId) throw new Error(`sim: derive source missing ${req.source}`);
      mutate(() => {
        data.tags[`${SIM_REPO}:derive`] = sourceId;
      });
      const base = data.images[sourceId]!;
      const derived: Image = {
        ...base,
        schema: req.schema,
        labels: `${req.commit ?? "legacy"}/${req.indexing ?? "none"}/${req.executable}`,
        recreateFails: checkedOut.recreateFails === true,
      };
      const id = imageId(derived);
      mutate(() => {
        data.images[id] = derived;
        data.tags[req.tag] = id;
      });
      mutate(() => {
        delete data.tags[`${SIM_REPO}:derive`];
      });
    },
    tagWriter: async (image) => {
      const id = resolve(image);
      if (!id) throw new Error(`sim: tag source missing ${image}`);
      mutate(() => {
        data.tags[WRITER] = id;
      });
    },
    recreate: async () => {
      const id = data.tags[WRITER];
      if (!id) throw new Error("sim: --no-build with no writer image");
      data.recreateCallCount += 1;
      const call = data.recreateCallCount;
      const img = data.images[id]!;
      if (data.failRecreateCalls.includes(call) || img.recreateFails === true) {
        return 1;
      }
      mutate(() => startContainer(data, id, img.schema, true));
      return 0;
    },
    writerNodeVersion: async () => (data.container?.answering ? "v24.22.1" : null),
    listRepositoryTags: async () =>
      Object.keys(data.tags)
        .filter((t) => t.startsWith(`${SIM_REPO}:`))
        .map((t) => t.slice(SIM_REPO.length + 1)),
    removeImageTag: async (image) =>
      mutate(() => {
        delete data.tags[image];
      }),
    pruneImages: async () =>
      mutate(() => {
        const used = new Set([...Object.values(data.tags), data.container?.imageId]);
        for (const id of Object.keys(data.images)) {
          if (!used.has(id)) delete data.images[id];
        }
      }),
    deleteLegacyFile: async () =>
      mutate(() => {
        data.legacyFile = null;
      }),
  };
  return { world, lines, mutations: () => mutations };
}

/** Host step before the procedure: the clean base image of the checkout. */
export function simBuildBase(data: SimData, c: SimCommit): void {
  const base: Image = {
    identity: c.indexing,
    buildId: c.buildId,
    answers: c.answers,
    schema: null,
    labels: `${SIM_REPO}`,
    recreateFails: c.recreateFails === true,
  };
  const id = imageId(base);
  data.images[id] = base;
  data.tags[DEPLOY] = id;
}

/** Images and schema entries are never mutated in place, so a shallow copy suffices. */
export function cloneSim(data: SimData): SimData {
  return {
    images: { ...data.images },
    tags: { ...data.tags },
    container: data.container ? { ...data.container } : null,
    schemas: { ...data.schemas },
    stateFile: data.stateFile,
    legacyFile: data.legacyFile,
    violations: [...data.violations],
    failRecreateCalls: [...data.failRecreateCalls],
    recreateCallCount: data.recreateCallCount,
  };
}

export function simKey(data: SimData): string {
  const sorted = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  return JSON.stringify({
    images: Object.keys(data.images).sort(),
    tags: sorted(data.tags),
    container: data.container,
    schemas: sorted(data.schemas),
    stateFile: data.stateFile,
    legacyFile: data.legacyFile !== null,
  });
}
