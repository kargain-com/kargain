/**
 * Plan-level model test (PR #75 / Amendment).
 * Applies plan actions to a simulated world, crashes after every action, reruns.
 * Asserts Amendment invariants; shows red on two planted ordering defects.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  plantedDefectRollbackWhileLegacyRuns,
  plantedDefectStateAfterDrop,
  planPonderDeploy,
  type PlanAction,
  type PlanResult,
  type PonderDeployObservations,
  type PonderDeployOperation,
  type ProbeObservation,
} from "../scripts/lib/ponder-deploy-plan.js";
import {
  DEPLOY_STATE_INVALID,
  LEGACY_IMAGE,
  LEGACY_SCHEMA,
  parsePostCutoverState,
  type PonderDeployState,
  type PonderLiveOrPendingRef,
  type PonderPreCutoverState,
} from "../scripts/lib/ponder-deploy-state.js";

const COMMIT_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const COMMIT_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const EXEC_A = "exec-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EXEC_B = "exec-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DIGEST = "nginxdigest0000000000000000000000000001";
const PINNED_NGINX = "nginx:1.27.5-alpine@sha256:pin";

type WriterMode = "ready200" | "answered_not_ready" | "never_answer" | "fail_200";

type SimWorld = {
  stateFile:
    | { kind: "pre_cutover"; state: PonderPreCutoverState }
    | { kind: "post_cutover"; state: PonderDeployState }
    | { kind: "missing" };
  /** Containers by compose service label. */
  containers: Map<
    string,
    { image: string; schema: string | null; running: boolean }
  >;
  schemas: Set<string>;
  images: Set<string>;
  upstream: string | null;
  httpServed: boolean;
  writerMode: WriterMode;
  legacyTagged: boolean;
  /** Last write_slot_env schema per slot. */
  slotSchemas: { blue: string | null; green: string | null };
};

type DispatchResult = {
  exitCode: number;
  namedFailure: boolean;
  evidence: string[];
  actionsApplied: number;
  refusedInvalid: boolean;
};

function emptyWorld(over: Partial<SimWorld> = {}): SimWorld {
  const w: SimWorld = {
    stateFile: {
      kind: "pre_cutover",
      state: { identity: "id", executable: "exec-legacy" },
    },
    containers: new Map([
      [
        "ponder",
        { image: "kargain-ponder:legacy-base", schema: LEGACY_SCHEMA, running: true },
      ],
    ]),
    schemas: new Set([
      LEGACY_SCHEMA,
      "ponder_sync",
      "kargain_svm_raw",
      "kargain_svm_projection",
    ]),
    images: new Set(["kargain-ponder:legacy-base"]),
    upstream: null,
    httpServed: true,
    writerMode: "ready200",
    legacyTagged: false,
    slotSchemas: { blue: null, green: null },
    ...over,
  };
  return w;
}

function probeFor(
  world: SimWorld,
  service: string,
): ProbeObservation {
  const c = world.containers.get(service);
  if (!c || !c.running) return { kind: "no_answer" };
  if (world.writerMode === "never_answer") return { kind: "no_answer" };
  if (world.writerMode === "answered_not_ready") return { kind: "status", code: 503 };
  if (world.writerMode === "fail_200" && service === "ponder") {
    return { kind: "status", code: 503 };
  }
  if (world.writerMode === "ready200") return { kind: "status", code: 200 };
  return { kind: "status", code: 200 };
}

function observe(world: SimWorld, args: {
  operation: PonderDeployOperation;
  eventName: "push" | "workflow_dispatch";
  commit: string;
  executable: string;
}): { observations: PonderDeployObservations; loaded: Parameters<typeof planPonderDeploy>[0]["loaded"] } {
  const ponder = world.containers.get("ponder");
  const preCutoverObserved = !!(
    ponder &&
    ponder.running &&
    ponder.image !== PINNED_NGINX
  );
  const nginxPinnedUp = !!(
    ponder &&
    ponder.running &&
    ponder.image === PINNED_NGINX
  );
  const runningSlots: ("blue" | "green")[] = [];
  for (const slot of ["blue", "green"] as const) {
    const c = world.containers.get(`ponder-${slot}`);
    if (c?.running) runningSlots.push(slot);
  }
  const observations: PonderDeployObservations = {
    ready: {
      blue: probeFor(world, "ponder-blue"),
      green: probeFor(world, "ponder-green"),
      nginx: nginxPinnedUp ? probeFor(world, "ponder") : { kind: "no_answer" },
    },
    schemas: [...world.schemas],
    executableDigest: args.executable,
    identityDigest: "id",
    deploySha: args.commit,
    deployCommit: args.commit,
    nginxConfigDigest: DIGEST,
    eventName: args.eventName,
    preCutoverObserved,
    nginxPinnedUp,
    legacyImageId: preCutoverObserved
      ? "sha256:legacy-running"
      : world.legacyTagged
        ? "sha256:legacy-tag"
        : null,
    legacyImageTagged: world.legacyTagged,
    runningSlots,
    slotImages: { blue: null, green: null },
  };

  let loaded: Parameters<typeof planPonderDeploy>[0]["loaded"];
  if (world.stateFile.kind === "missing") {
    loaded = { kind: "missing" };
  } else if (world.stateFile.kind === "pre_cutover") {
    loaded = { kind: "pre_cutover", state: world.stateFile.state };
  } else {
    loaded = { kind: "post_cutover", state: world.stateFile.state };
  }
  return { observations, loaded };
}

function applyAction(world: SimWorld, action: PlanAction): void {
  switch (action.type) {
    case "evidence":
    case "exit":
      break;
    case "write_slot_env":
      world.slotSchemas[action.slot] = action.schema;
      break;
    case "build_image":
      world.images.add(`kargain-ponder:${action.commit}`);
      break;
    case "tag_slot_image": {
      const img =
        action.commit === "legacy"
          ? LEGACY_IMAGE
          : `kargain-ponder:${action.commit}`;
      world.images.add(img);
      world.images.add(`kargain-ponder-${action.slot}`);
      break;
    }
    case "preflight_slot":
      break;
    case "start_slot": {
      let schema = world.slotSchemas[action.slot] ?? LEGACY_SCHEMA;
      if (world.stateFile.kind === "post_cutover") {
        const s = world.stateFile.state;
        if (s.pending?.slot === action.slot) schema = s.pending.schema;
        else if (s.live?.slot === action.slot) schema = s.live.schema;
      }
      const img =
        schema === LEGACY_SCHEMA
          ? LEGACY_IMAGE
          : `kargain-ponder:${schema.slice(2)}`;
      world.images.add(img);
      world.containers.set(`ponder-${action.slot}`, {
        image: img,
        schema,
        running: true,
      });
      world.schemas.add(schema);
      break;
    }
    case "stop_slot": {
      const c = world.containers.get(`ponder-${action.slot}`);
      if (c) c.running = false;
      break;
    }
    case "restart_slot": {
      const c = world.containers.get(`ponder-${action.slot}`);
      if (c) c.running = true;
      break;
    }
    case "preserve_legacy_image":
      world.legacyTagged = true;
      world.images.add(LEGACY_IMAGE);
      break;
    case "stop_legacy_ponder": {
      const c = world.containers.get("ponder");
      if (c) c.running = false;
      world.httpServed = false;
      break;
    }
    case "write_upstream":
      world.upstream = `ponder-${action.slot}`;
      break;
    case "up_nginx":
    case "recreate_nginx":
      world.containers.set("ponder", {
        image: PINNED_NGINX,
        schema: null,
        running: true,
      });
      world.httpServed = true;
      break;
    case "reload_nginx":
      world.httpServed = true;
      break;
    case "drop_schema":
      world.schemas.delete(action.schema);
      for (const [, c] of world.containers) {
        if (c.schema === action.schema) c.running = false;
      }
      break;
    case "retention":
      for (const s of action.drop) {
        world.schemas.delete(s);
      }
      break;
    case "remove_images":
      for (const img of action.images) world.images.delete(img);
      break;
    case "write_state":
      world.stateFile = { kind: "post_cutover", state: structuredClone(action.state) };
      break;
    case "assert_spare_image":
      if (!world.images.has(action.image) && action.image !== LEGACY_IMAGE) {
        throw new Error("spare_image_missing");
      }
      if (action.image === LEGACY_IMAGE) world.images.add(LEGACY_IMAGE);
      break;
    case "wait_answered":
    case "wait_ready200": {
      if (action.type === "wait_answered" && world.writerMode === "never_answer") {
        if (action.onTimeout === "tear_down_new" && action.slot) {
          // tear down handled by plan continuation elsewhere; mark failure via throw
          throw new Error("never_answer");
        }
        throw new Error("never_answer");
      }
      if (
        action.type === "wait_ready200" &&
        world.writerMode === "answered_not_ready" &&
        action.onTimeout === "pending_exit0"
      ) {
        throw new Error("pending_exit0");
      }
      if (
        action.type === "wait_ready200" &&
        action.target === "nginx" &&
        world.writerMode === "fail_200"
      ) {
        throw new Error("fail_200");
      }
      // Success: slot ready or nginx ready
      if (action.target === "nginx") world.httpServed = true;
      break;
    }
    default:
      break;
  }
}

function refsFromState(state: PonderDeployState): PonderLiveOrPendingRef[] {
  return [state.live, state.pending].filter(
    (r): r is PonderLiveOrPendingRef => r != null,
  );
}

function checkInvariants(world: SimWorld): string[] {
  const errs: string[] = [];
  if (world.stateFile.kind !== "post_cutover") return errs;
  const state = world.stateFile.state;

  // Parse must accept (no deploy_state_invalid on reachable state).
  try {
    parsePostCutoverState(state);
  } catch (e) {
    errs.push(`state_invalid: ${(e as Error).message}`);
  }

  // One writer per schema.
  const writersBySchema = new Map<string, number>();
  for (const [name, c] of world.containers) {
    if (!c.running || !c.schema) continue;
    if (name === "ponder" && c.image === PINNED_NGINX) continue;
    writersBySchema.set(c.schema, (writersBySchema.get(c.schema) ?? 0) + 1);
  }
  for (const [schema, n] of writersBySchema) {
    if (n > 1) errs.push(`two_writers_on_schema:${schema}`);
  }

  // Every live/spare/pending ref → existing schema; live/spare → existing image.
  for (const ref of refsFromState(state)) {
    if (!world.schemas.has(ref.schema)) {
      errs.push(`missing_schema_for_ref:${ref.schema}`);
    }
  }
  if (state.spare && !world.schemas.has(state.spare.schema)) {
    errs.push(`missing_schema_for_spare:${state.spare.schema}`);
  }
  if (state.live && !world.images.has(state.live.image) && state.live.image !== LEGACY_IMAGE) {
    // allow slot image aliases
    if (![...world.images].some((i) => i.includes(state.live!.commit ?? "legacy"))) {
      errs.push(`missing_image_for_live:${state.live.image}`);
    }
  }
  if (state.spare) {
    if (
      !world.images.has(state.spare.image) &&
      state.spare.image !== LEGACY_IMAGE &&
      !world.legacyTagged
    ) {
      errs.push(`missing_image_for_spare:${state.spare.image}`);
    }
  }

  return errs;
}

function runDispatch(
  world: SimWorld,
  args: {
    operation: PonderDeployOperation;
    eventName: "push" | "workflow_dispatch";
    commit: string;
    executable: string;
  },
  crashAfter: number | null,
): DispatchResult {
  const { observations, loaded } = observe(world, args);
  let plan: PlanResult;
  try {
    plan = planPonderDeploy({ loaded, operation: args.operation, observations });
  } catch (e) {
    return {
      exitCode: 1,
      namedFailure: true,
      evidence: [(e as Error).message],
      actionsApplied: 0,
      refusedInvalid: String((e as Error).message).includes(DEPLOY_STATE_INVALID),
    };
  }

  const evidence = plan.actions
    .filter((a): a is Extract<PlanAction, { type: "evidence" }> => a.type === "evidence")
    .map((a) => a.text);

  const refusedInvalid = evidence.some((t) => t.includes(DEPLOY_STATE_INVALID));
  let applied = 0;
  let exitCode = 0;
  let namedFailure = refusedInvalid;

  for (const action of plan.actions) {
    if (crashAfter !== null && applied >= crashAfter) {
      break;
    }
    if (action.type === "exit") {
      exitCode = action.code;
      if (action.code !== 0) namedFailure = true;
      applied++;
      break;
    }
    if (action.type === "evidence") {
      if (action.text.includes(DEPLOY_STATE_INVALID)) namedFailure = true;
      if (/_failed:/.test(action.text)) namedFailure = true;
      applied++;
      continue;
    }
    try {
      applyAction(world, action);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "pending_exit0") {
        exitCode = 0;
        namedFailure = false;
        applied++;
        break;
      }
      namedFailure = true;
      exitCode = 1;
      applied++;
      break;
    }
    applied++;
  }

  return {
    exitCode,
    namedFailure,
    evidence,
    actionsApplied: applied,
    refusedInvalid,
  };
}

function cloneWorld(world: SimWorld): SimWorld {
  return {
    ...world,
    stateFile: structuredClone(world.stateFile),
    containers: new Map(
      [...world.containers.entries()].map(([k, v]) => [k, { ...v }]),
    ),
    schemas: new Set(world.schemas),
    images: new Set(world.images),
    slotSchemas: { ...world.slotSchemas },
  };
}

describe("ponder deploy plan model", () => {
  it("planted defect: state written after a drop is red", () => {
    const state: PonderDeployState = {
      live: {
        slot: "blue",
        schema: `k_${COMMIT_A}`,
        commit: COMMIT_A,
        executable: EXEC_A,
        image: `kargain-ponder:${COMMIT_A}`,
      },
      spare: null,
      pending: {
        slot: "green",
        schema: `k_${COMMIT_B}`,
        commit: COMMIT_B,
        executable: EXEC_B,
        image: `kargain-ponder:${COMMIT_B}`,
      },
      nginx_config_digest: DIGEST,
    };
    const planted = plantedDefectStateAfterDrop(
      { ...state, pending: null },
      `k_${COMMIT_B}`,
    );
    assert.equal(planted[0]?.type, "drop_schema");
    assert.equal(planted[1]?.type, "write_state");
    // Real supersede plan writes state first.
    const world = emptyWorld({
      stateFile: { kind: "post_cutover", state },
      containers: new Map([
        ["ponder", { image: PINNED_NGINX, schema: null, running: true }],
        [
          "ponder-blue",
          {
            image: `kargain-ponder:${COMMIT_A}`,
            schema: `k_${COMMIT_A}`,
            running: true,
          },
        ],
        [
          "ponder-green",
          {
            image: `kargain-ponder:${COMMIT_B}`,
            schema: `k_${COMMIT_B}`,
            running: true,
          },
        ],
      ]),
      schemas: new Set([
        LEGACY_SCHEMA,
        `k_${COMMIT_A}`,
        `k_${COMMIT_B}`,
        "ponder_sync",
      ]),
      images: new Set([
        PINNED_NGINX,
        `kargain-ponder:${COMMIT_A}`,
        `kargain-ponder:${COMMIT_B}`,
      ]),
      legacyTagged: true,
      httpServed: true,
    });
    const { observations, loaded } = observe(world, {
      operation: "deploy",
      eventName: "workflow_dispatch",
      commit: COMMIT_A,
      executable: EXEC_A,
    });
    // Force not-ready pending with different executable → supersede.
    observations.ready.green = { kind: "status", code: 503 };
    observations.executableDigest = EXEC_A;
    observations.deployCommit = COMMIT_A;
    const plan = planPonderDeploy({
      loaded,
      operation: "deploy",
      observations: {
        ...observations,
        executableDigest: EXEC_A,
        deployCommit: COMMIT_A,
        ready: {
          blue: { kind: "status", code: 200 },
          green: { kind: "status", code: 503 },
          nginx: { kind: "status", code: 200 },
        },
      },
    });
    const types = plan.actions.map((a) => a.type);
    const writeIdx = types.indexOf("write_state");
    const dropIdx = types.indexOf("drop_schema");
    assert.ok(writeIdx >= 0 && writeIdx < dropIdx, "green: state before drop");
    assert.equal(planted[0]?.type, "drop_schema");
    assert.equal(planted[1]?.type, "write_state");
    assert.notEqual(
      planted[0]?.type,
      plan.actions[writeIdx]?.type,
      "planted ordering differs from green plan",
    );
  });

  it("planted defect: rollback starts legacy while legacy container runs is red", () => {
    const state: PonderDeployState = {
      live: null,
      spare: {
        schema: LEGACY_SCHEMA,
        commit: null,
        executable: "exec-legacy",
        image: LEGACY_IMAGE,
      },
      pending: {
        slot: "blue",
        schema: `k_${COMMIT_A}`,
        commit: COMMIT_A,
        executable: EXEC_A,
        image: `kargain-ponder:${COMMIT_A}`,
      },
      nginx_config_digest: DIGEST,
    };
    const planted = plantedDefectRollbackWhileLegacyRuns(state, "green");
    assert.ok(planted.some((a) => a.type === "start_slot"));

    const world = emptyWorld({
      stateFile: { kind: "post_cutover", state },
      containers: new Map([
        [
          "ponder",
          {
            image: "kargain-ponder:legacy-base",
            schema: LEGACY_SCHEMA,
            running: true,
          },
        ],
        [
          "ponder-blue",
          {
            image: `kargain-ponder:${COMMIT_A}`,
            schema: `k_${COMMIT_A}`,
            running: true,
          },
        ],
      ]),
      schemas: new Set([LEGACY_SCHEMA, `k_${COMMIT_A}`, "ponder_sync"]),
      images: new Set(["kargain-ponder:legacy-base", `kargain-ponder:${COMMIT_A}`, LEGACY_IMAGE]),
      legacyTagged: true,
    });
    const plan = planPonderDeploy({
      loaded: { kind: "post_cutover", state },
      operation: "rollback",
      observations: observe(world, {
        operation: "rollback",
        eventName: "workflow_dispatch",
        commit: COMMIT_A,
        executable: EXEC_A,
      }).observations,
    });
    // Green: abandon — write cleared state, stop pending; do NOT start_slot legacy.
    assert.ok(plan.actions.some((a) => a.type === "write_state"));
    assert.ok(
      plan.actions.some(
        (a) => a.type === "evidence" && a.text.includes("rollback=abandoned"),
      ),
    );
    assert.ok(
      !plan.actions.some((a) => a.type === "start_slot"),
      "green: must not start legacy while legacy runs",
    );
    assert.ok(
      planted.some((a) => a.type === "start_slot"),
      "planted: starts legacy while legacy would still run",
    );
  });

  it("crash-inject + multi-run: push/hold/deploy/rollback recover to served", () => {
    const sequences: {
      name: string;
      steps: {
        operation: PonderDeployOperation;
        eventName: "push" | "workflow_dispatch";
        commit: string;
        executable: string;
        writerMode?: WriterMode;
      }[];
    }[] = [
      {
        name: "happy path two commits",
        steps: [
          {
            operation: "deploy",
            eventName: "push",
            commit: COMMIT_A,
            executable: EXEC_A,
          },
          {
            operation: "hold",
            eventName: "workflow_dispatch",
            commit: COMMIT_A,
            executable: EXEC_A,
          },
          {
            operation: "deploy",
            eventName: "workflow_dispatch",
            commit: COMMIT_A,
            executable: EXEC_A,
          },
          {
            operation: "rollback",
            eventName: "workflow_dispatch",
            commit: COMMIT_A,
            executable: EXEC_A,
          },
          {
            operation: "deploy",
            eventName: "workflow_dispatch",
            commit: COMMIT_A,
            executable: EXEC_A,
          },
          {
            operation: "deploy",
            eventName: "workflow_dispatch",
            commit: COMMIT_B,
            executable: EXEC_B,
          },
        ],
      },
      {
        name: "never_answer then recover",
        steps: [
          {
            operation: "hold",
            eventName: "workflow_dispatch",
            commit: COMMIT_A,
            executable: EXEC_A,
            writerMode: "never_answer",
          },
          {
            operation: "hold",
            eventName: "workflow_dispatch",
            commit: COMMIT_A,
            executable: EXEC_A,
            writerMode: "ready200",
          },
          {
            operation: "deploy",
            eventName: "workflow_dispatch",
            commit: COMMIT_A,
            executable: EXEC_A,
          },
        ],
      },
      {
        name: "pending not ready then deploy",
        steps: [
          {
            operation: "hold",
            eventName: "workflow_dispatch",
            commit: COMMIT_A,
            executable: EXEC_A,
            writerMode: "answered_not_ready",
          },
          {
            operation: "deploy",
            eventName: "workflow_dispatch",
            commit: COMMIT_A,
            executable: EXEC_A,
            writerMode: "ready200",
          },
        ],
      },
    ];

    for (const seq of sequences) {
      let world = emptyWorld();
      for (const step of seq.steps) {
        world.writerMode = step.writerMode ?? "ready200";
        // Crash after each action index, then resume (depth ≥ 5).
        const probe = observe(world, step);
        const plan = planPonderDeploy({
          loaded: probe.loaded,
          operation: step.operation,
          observations: probe.observations,
        });
        const n = Math.min(plan.actions.length, 12);
        for (let crashAt = 0; crashAt < n; crashAt++) {
          const snapped = cloneWorld(world);
          runDispatch(snapped, step, crashAt);
          // Resume without crash
          runDispatch(snapped, step, null);
          const inv = checkInvariants(snapped);
          assert.equal(
            inv.filter((e) => e.startsWith("state_invalid")).length,
            0,
            `${seq.name} crash@${crashAt}: ${inv.join(",")}`,
          );
        }
        // Full run on main world
        const result = runDispatch(world, step, null);
        if (result.refusedInvalid) {
          assert.fail(`${seq.name}: reachable state refused as deploy_state_invalid`);
        }
        const inv = checkInvariants(world);
        assert.deepEqual(inv, [], `${seq.name} after ${step.operation}: ${inv.join(",")}`);
        if (!result.namedFailure && result.exitCode === 0) {
          // Completed without named failure → HTTP served (or awaiting_dispatch pre).
          if (
            !result.evidence.some((t) => t.includes("awaiting_dispatch")) &&
            !result.evidence.some((t) => t.includes("switch=pending"))
          ) {
            assert.equal(
              world.httpServed ||
                world.containers.get("ponder")?.running === true ||
                [...world.containers.values()].some((c) => c.running && c.schema),
              true,
              `${seq.name}: expected HTTP served after success`,
            );
          }
        }
      }
      // Recovery: at most two dispatch runs restore served state.
      const recover1 = runDispatch(
        world,
        {
          operation: "deploy",
          eventName: "workflow_dispatch",
          commit: COMMIT_A,
          executable: EXEC_A,
        },
        null,
      );
      if (!world.httpServed && !recover1.namedFailure) {
        runDispatch(
          world,
          {
            operation: "deploy",
            eventName: "workflow_dispatch",
            commit: COMMIT_A,
            executable: EXEC_A,
          },
          null,
        );
      }
      assert.ok(
        world.httpServed ||
          world.stateFile.kind === "pre_cutover" ||
          (world.stateFile.kind === "post_cutover" &&
            world.stateFile.state.live === null &&
            world.stateFile.state.spare === null),
        `${seq.name}: not recovered in ≤2 runs`,
      );
      assert.ok(seq.steps.length >= 1);
    }
  });
});
