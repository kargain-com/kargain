/**
 * Sole owner of the Ponder deploy procedure (ADR 0016 §f–§k): first run,
 * switch (deploy, rollback, resumption), retention, evidence.
 *
 * The procedure runs over a {@link DeployWorld}. Production binds it to the
 * host (docker, through the step journal of scripts/ponder-deploy-step.ts) and
 * to the `ponder-deploy` container (state file, digests, preflight, probes,
 * Postgres). The crash-injection test binds it to a simulated Docker and
 * Ponder world. Every effect goes through the world; the procedure keeps no
 * other state, so a crash anywhere is resumed by the next run.
 */
import {
  PONDER_READY_DEFAULT_URL,
  PONDER_READY_TIMEOUT_MS,
  ponderDidNotBecomeReadyMessage,
  type PonderReadyMode,
  type PonderReadyProbeResult,
} from "./ponder-readiness-probe.js";
import { imageTagsToRemove, schemasToDrop } from "./ponder-deploy-retention.js";
import {
  DeployStateInvalid,
  LEGACY_SCHEMA,
  observationDefect,
  parseDeployState,
  parseLegacyFingerprints,
  refImage,
  refLabel,
  refSchema,
  WRITER_IMAGE_TAG,
  DEPLOY_IMAGE_TAG,
  type DeployObservation,
  type DeployRef,
  type DeployState,
  type StateFileRead,
} from "./ponder-deploy-state.js";

export type DeployOperation = "deploy" | "rollback";

export const DEPLOY_OPERATIONS: readonly DeployOperation[] = ["deploy", "rollback"];

export type DeriveRequest = {
  /** Image (tag or ID) the writer image is built `FROM`. */
  source: string;
  /** Tag the derived writer image receives. */
  tag: string;
  schema: string;
  commit: string | null;
  indexing: string | null;
  executable: string;
};

export type DeployWorld = {
  print(line: string): Promise<void>;
  // ponder-deploy container
  readState(): Promise<StateFileRead>;
  writeState(state: DeployState): Promise<void>;
  identities(): Promise<{ indexing: string; executable: string }>;
  /** ADR 0012 preflight; prints its own lines; returns its exit code. */
  preflight(): Promise<number>;
  probe(mode: PonderReadyMode): Promise<PonderReadyProbeResult>;
  listSchemas(): Promise<string[]>;
  dropSchema(schema: string): Promise<void>;
  readBuildId(schema: string): Promise<string | null>;
  // host
  observe(images: readonly string[]): Promise<DeployObservation>;
  derive(req: DeriveRequest): Promise<void>;
  tagWriter(image: string): Promise<void>;
  /** Host `compose up` status: 0 answered the recreate; non-zero is §g failure. */
  recreate(): Promise<number>;
  writerNodeVersion(): Promise<string | null>;
  listRepositoryTags(): Promise<string[]>;
  removeImageTag(image: string): Promise<void>;
  pruneImages(): Promise<void>;
  deleteLegacyFile(): Promise<void>;
};

/** Defects the crash-injection test plants to prove it can fail. */
export type PlantedDeployDefects = {
  noWriteAhead?: boolean;
  retentionDropsPrevious?: boolean;
  bootstrapWritesStateFirst?: boolean;
  firstRunWritesStateUnanswered?: boolean;
};

export type DeployRunInput = {
  operation: DeployOperation;
  /** DEPLOY_SHA — the checked-out commit the base image was built from. */
  commit: string;
  repository: string;
  planted?: PlantedDeployDefects;
};

type Run = {
  world: DeployWorld;
  input: DeployRunInput;
  writer: string;
};

async function evidence(run: Run, field: string): Promise<void> {
  await run.world.print(`deploy_evidence ${field}`);
}

async function stateInvalid(run: Run, detail: string): Promise<number> {
  await run.world.print(`deploy_state_invalid: ${detail}`);
  return 1;
}

function unansweredProbe(): Extract<PonderReadyProbeResult, { ok: false }> {
  return {
    ok: false,
    mode: "answered",
    url: PONDER_READY_DEFAULT_URL,
    timeoutMs: PONDER_READY_TIMEOUT_MS,
    elapsedMs: 0,
    lastStatus: null,
  };
}

async function didNotBecomeReady(
  run: Run,
  result: Extract<PonderReadyProbeResult, { ok: false }>,
): Promise<void> {
  await run.world.print(
    ponderDidNotBecomeReadyMessage(result.url, result.timeoutMs),
  );
}

/** Non-zero recreate is the same as an unanswered probe (ADR 0016 §g). */
async function recreateThenAnswered(run: Run): Promise<PonderReadyProbeResult> {
  const status = await run.world.recreate();
  if (status !== 0) return unansweredProbe();
  return run.world.probe("answered");
}

async function observedSchema(run: Run): Promise<string> {
  const obs = await run.world.observe([run.writer]);
  return obs.container?.schema ?? "none";
}

async function retention(run: Run, state: DeployState): Promise<void> {
  const { world, input } = run;
  const kept = input.planted?.retentionDropsPrevious
    ? { current: state.current, previous: null }
    : state;
  for (const schema of schemasToDrop(await world.listSchemas(), kept)) {
    await world.dropSchema(schema);
  }
  const tags = await world.listRepositoryTags();
  for (const tag of imageTagsToRemove(tags, kept, input.repository)) {
    await world.removeImageTag(`${input.repository}:${tag}`);
  }
  await world.pruneImages();
}

/** ADR 0016 §f first run. Returns the adopted state, or an exit code. */
async function firstRun(run: Run): Promise<DeployState | number> {
  const { world, input } = run;
  const legacyImage = refImage(input.repository, null);
  const obs = await world.observe([run.writer, legacyImage]);
  if (obs.legacyFile === null) return stateInvalid(run, "state_absent");
  if (!obs.container) return stateInvalid(run, "writer_container_missing");
  if (obs.container.schema !== LEGACY_SCHEMA) {
    return stateInvalid(run, "first_run_schema_not_legacy");
  }
  let executable: string;
  try {
    executable = parseLegacyFingerprints(obs.legacyFile);
  } catch (err) {
    if (err instanceof DeployStateInvalid) return stateInvalid(run, err.detail);
    throw err;
  }
  const legacy: DeployRef = {
    commit: null,
    image: legacyImage,
    indexing: null,
    executable,
  };
  const adopted: DeployState = { current: legacy, previous: null, switching: null };

  if (input.planted?.bootstrapWritesStateFirst) await world.writeState(adopted);
  await world.derive({
    source: obs.container.imageId,
    tag: legacyImage,
    schema: LEGACY_SCHEMA,
    commit: null,
    indexing: null,
    executable,
  });
  await world.tagWriter(legacyImage);
  const answered = await recreateThenAnswered(run);
  if (!answered.ok) {
    if (input.planted?.firstRunWritesStateUnanswered) {
      await world.writeState(adopted);
    }
    await didNotBecomeReady(run, answered);
    return 1;
  }
  await world.writeState(adopted);
  await evidence(run, `adopted=legacy schema=${LEGACY_SCHEMA}`);
  await evidence(run, `ready=ponder status=${answered.status}`);
  await world.deleteLegacyFile();
  return adopted;
}

type SwitchOutcome =
  | { kind: "committed"; state: DeployState; exit: number | null }
  | { kind: "ended"; exit: number };

/**
 * ADR 0016 §g steps 2–6 for `state.switching`. A resumed commit continues the
 * run (`exit: null`); every other outcome ends it.
 */
async function switchSteps(
  run: Run,
  state: DeployState,
  opts: { resumed: boolean; preflightOk: boolean },
): Promise<SwitchOutcome> {
  const { world } = run;
  const target = state.switching;
  if (!target) throw new Error("switchSteps requires switching");

  await world.tagWriter(target.image);
  const answered = await recreateThenAnswered(run);

  if (answered.ok) {
    const committed: DeployState = {
      current: target,
      previous: state.current,
      switching: null,
    };
    await world.writeState(committed);
    if (opts.resumed) {
      await evidence(run, "resolved=committed");
      await retention(run, committed);
      return { kind: "committed", state: committed, exit: null };
    }
    if (opts.preflightOk) await evidence(run, "preflight=ok");
    await evidence(run, "outcome=recreated");
    await evidence(run, `commit=${refLabel(target)}`);
    const schema = await observedSchema(run);
    await evidence(run, `schema=${schema}`);
    await evidence(run, `indexing=${target.indexing ?? "none"}`);
    await evidence(run, `executable=${target.executable}`);
    const buildId = await world.readBuildId(refSchema(target));
    await evidence(run, `build_id=${buildId ?? "none"}`);
    const node = await world.writerNodeVersion();
    await evidence(run, `node=${node ?? "none"}`);
    await evidence(run, `ready=ponder status=${answered.status}`);
    await retention(run, committed);

    const ready = await world.probe("ready200");
    if (ready.ok) {
      await evidence(run, `switch=ready status=${ready.status}`);
      return { kind: "committed", state: committed, exit: 0 };
    }
    if (ready.lastStatus !== null) {
      await evidence(run, `switch=catching_up status=${ready.lastStatus}`);
      return { kind: "committed", state: committed, exit: 0 };
    }
    await world.print(
      `ponder_stopped_answering: GET ${ready.url} stopped answering within ${ready.timeoutMs}ms`,
    );
    return { kind: "committed", state: committed, exit: 1 };
  }

  await didNotBecomeReady(run, answered);
  await world.tagWriter(state.current.image);
  const returnStatus = await world.recreate();
  if (returnStatus !== 0) {
    await world.print(
      `deploy_return_failed: ${refLabel(state.current)} did not answer; switching left set`,
    );
    return { kind: "ended", exit: 1 };
  }
  const restored = await world.probe("answered");
  if (!restored.ok) {
    await world.print(
      `deploy_return_failed: ${refLabel(state.current)} did not answer; switching left set`,
    );
    return { kind: "ended", exit: 1 };
  }
  const returned: DeployState = { ...state, switching: null };
  await world.writeState(returned);
  await retention(run, returned);
  await evidence(run, "outcome=returned");
  await evidence(run, `commit=${refLabel(state.current)}`);
  await evidence(run, `schema=${await observedSchema(run)}`);
  await evidence(run, `ready=ponder status=${restored.status}`);
  return { kind: "ended", exit: 1 };
}

/** §g step 1 then steps 2–6 for a fresh target. */
async function switchTo(
  run: Run,
  state: DeployState,
  target: DeployRef,
  preflightOk: boolean,
): Promise<number> {
  const switching: DeployState = { ...state, switching: target };
  if (!run.input.planted?.noWriteAhead) await run.world.writeState(switching);
  const outcome = await switchSteps(run, switching, {
    resumed: false,
    preflightOk,
  });
  return outcome.exit ?? 0;
}

function namedImages(run: Run, state: DeployState): string[] {
  const names = [run.writer, state.current.image];
  if (state.previous) names.push(state.previous.image);
  return names;
}

async function deploy(run: Run, state: DeployState, obs: DeployObservation): Promise<number> {
  const { world, input } = run;
  const ids = await world.identities();
  if (ids.executable === state.current.executable) {
    await evidence(run, "outcome=unchanged");
    await evidence(run, `executable=${state.current.executable}`);
    await evidence(run, `schema=${obs.container?.schema ?? "none"}`);
    const node = await world.writerNodeVersion();
    await evidence(run, `node=${node ?? "none"}`);
    const answered = await world.probe("answered");
    if (answered.ok) await evidence(run, `ready=ponder status=${answered.status}`);
    else await didNotBecomeReady(run, answered);
    await retention(run, state);
    return answered.ok ? 0 : 1;
  }

  if ((await world.preflight()) !== 0) {
    await evidence(run, "outcome=refused");
    return 1;
  }
  const target: DeployRef = {
    commit: input.commit,
    image: refImage(input.repository, input.commit),
    indexing: ids.indexing,
    executable: ids.executable,
  };
  await world.derive({
    source: `${input.repository}:${DEPLOY_IMAGE_TAG}`,
    tag: target.image,
    schema: refSchema(target),
    commit: target.commit,
    indexing: target.indexing,
    executable: target.executable,
  });
  return switchTo(run, state, target, true);
}

/** §i preconditions, checked before the generic observation. */
async function rollbackRefusal(
  run: Run,
  state: DeployState,
  obs: DeployObservation,
): Promise<number | null> {
  if (!state.previous) {
    await run.world.print("deploy_rollback_failed: no_previous");
    return 1;
  }
  if (!(obs.images[state.previous.image] ?? null)) {
    await run.world.print("deploy_rollback_failed: previous_image_missing");
    return 1;
  }
  return null;
}

/** One deploy run under the ADR 0010 lock. Returns the process exit code. */
export async function runPonderDeploy(
  world: DeployWorld,
  input: DeployRunInput,
): Promise<number> {
  const run: Run = {
    world,
    input,
    writer: `${input.repository}:${WRITER_IMAGE_TAG}`,
  };
  await evidence(run, `operation=${input.operation}`);

  const read = await world.readState();
  let state: DeployState;
  if (read.kind === "absent") {
    const adopted = await firstRun(run);
    if (typeof adopted === "number") return adopted;
    state = adopted;
  } else if (read.kind === "unreadable") {
    return stateInvalid(run, "state_unreadable");
  } else {
    try {
      state = parseDeployState(read.text, input.repository);
    } catch (err) {
      if (err instanceof DeployStateInvalid) return stateInvalid(run, err.detail);
      throw err;
    }
    if (state.switching) {
      const resumed = await switchSteps(run, state, {
        resumed: true,
        preflightOk: false,
      });
      if (resumed.kind === "ended") return resumed.exit;
      state = resumed.state;
    }
  }

  const obs = await world.observe(namedImages(run, state));
  if (input.operation === "rollback") {
    const refused = await rollbackRefusal(run, state, obs);
    if (refused !== null) return refused;
  }
  const defect = observationDefect(state, obs, run.writer);
  if (defect) return stateInvalid(run, defect);
  if (obs.legacyFile !== null) await world.deleteLegacyFile();

  if (input.operation === "deploy") return deploy(run, state, obs);
  return switchTo(run, state, state.previous!, false);
}
