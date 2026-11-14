/**
 * ADR 0016 Context §14 as an executable control: the real state, switch and
 * retention owners (runPonderDeploy) against a simulated Docker + Ponder
 * world. Exhaustive to five runs: every operation, a crash after every
 * mutation followed by a host reboot or a bare `docker compose up -d`.
 *
 * Properties:
 * - P1 no schema is written by an image of another identity;
 * - P2 from every reached state a clean deploy never answers
 *   deploy_state_invalid or deploy_return_failed;
 * - P3 the schemas and images of current and previous exist;
 * - P4 a settled state (switching null) runs current, answering.
 *
 * Four planted defects each turn it red.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseDeployState,
  refSchema,
} from "../scripts/lib/ponder-deploy-state.ts";
import {
  runPonderDeploy,
  type DeployOperation,
  type PlantedDeployDefects,
} from "../scripts/lib/ponder-deploy-switch.ts";
import {
  SIM_COMMITS,
  SIM_REPO,
  SimCrash,
  WRITER,
  cloneSim,
  initialSimData,
  simBareUp,
  simBuildBase,
  simKey,
  simReboot,
  simWorld,
  type Answers,
  type SimCommit,
  type SimData,
} from "./fixtures/ponder-deploy-sim.ts";

const DEPTH = 5;

type Op = { operation: DeployOperation; commit: SimCommit; label: string };

const OPS: Op[] = [
  { operation: "deploy", commit: SIM_COMMITS.c1, label: "deploy c1" },
  { operation: "deploy", commit: SIM_COMMITS.c2, label: "deploy c2 (API only)" },
  { operation: "deploy", commit: SIM_COMMITS.c3, label: "deploy c3 (indexing, same build_id)" },
  { operation: "deploy", commit: SIM_COMMITS.c4, label: "deploy c4 (never answers)" },
  { operation: "deploy", commit: SIM_COMMITS.c5, label: "deploy c5 (recreate fails)" },
  { operation: "rollback", commit: SIM_COMMITS.c1, label: "rollback" },
];

type RunResult = { exit: number | "crash"; lines: string[]; mutations: number };

async function runOnce(
  data: SimData,
  op: Op,
  crashAfter: number | null,
  planted: PlantedDeployDefects | undefined,
  snapshots?: SimData[],
): Promise<RunResult> {
  simBuildBase(data, op.commit);
  const sim = simWorld(data, op.commit, crashAfter, snapshots);
  try {
    const exit = await runPonderDeploy(sim.world, {
      operation: op.operation,
      commit: op.commit.commit,
      repository: SIM_REPO,
      planted,
    });
    return { exit, lines: sim.lines, mutations: sim.mutations() };
  } catch (err) {
    if (err instanceof SimCrash) return { exit: "crash", lines: sim.lines, mutations: sim.mutations() };
    throw err;
  }
}

function propertyViolations(data: SimData): string[] {
  const out = [...data.violations];
  if (data.stateFile === null) return out;
  const state = parseDeployState(data.stateFile, SIM_REPO);
  for (const [name, ref] of [
    ["current", state.current],
    ["previous", state.previous],
  ] as const) {
    if (!ref) continue;
    if (!data.schemas[refSchema(ref)]) out.push(`P3 ${name} schema ${refSchema(ref)} missing`);
    if (!data.tags[ref.image]) out.push(`P3 ${name} image ${ref.image} missing`);
  }
  if (state.switching === null) {
    const c = data.container;
    const currentId = data.tags[state.current.image];
    if (!c || c.imageId !== currentId) out.push("P4 settled state does not run current");
    else if (!c.answering) out.push("P4 settled writer does not answer");
  }
  return out;
}

const REFUSALS = /^(?:deploy_state_invalid|deploy_return_failed)/;

/** P2 for a state, given the result of a clean deploy of c1 from it. */
async function cleanDeployDefect(
  first: RunResult,
  after: SimData,
): Promise<string | null> {
  let r = first;
  let refusal = r.lines.find((l) => REFUSALS.test(l));
  if (!refusal && r.exit !== 0) {
    // A resumed return ends the first run; the second must not refuse.
    r = await runOnce(cloneSim(after), OPS[0]!, null, undefined);
    refusal = r.lines.find((l) => REFUSALS.test(l));
  }
  return refusal ? `P2 clean deploy: ${refusal}` : null;
}

type Exploration = {
  runs: number;
  states: number;
  violation: string | null;
};

type Node = { data: SimData; trail: string[] };

async function explore(
  legacyAnswers: Answers,
  planted?: PlantedDeployDefects,
): Promise<Exploration> {
  const root = initialSimData(legacyAnswers);
  const seen = new Set<string>([simKey(root)]);
  let frontier: Node[] = [{ data: root, trail: [] }];
  let runs = 0;
  const at = (trail: string[]) => `after ${trail.join(" → ") || "start"}`;

  const p2Of = async (node: Node, opResult?: { result: RunResult; after: SimData }) => {
    let r = opResult;
    if (!r) {
      const after = cloneSim(node.data);
      r = { result: await runOnce(after, OPS[0]!, null, undefined), after };
      runs += 1;
    }
    const defect = await cleanDeployDefect(r.result, r.after);
    return defect ? `${defect} ${at(node.trail)}` : null;
  };

  for (let depth = 0; depth < DEPTH; depth++) {
    const next: Node[] = [];
    for (const node of frontier) {
      for (const op of OPS) {
        const full = cloneSim(node.data);
        const snapshots: SimData[] = [];
        const result = await runOnce(full, op, null, planted, snapshots);
        runs += 1 + snapshots.length;
        if (op === OPS[0] && !planted) {
          const p2 = await p2Of(node, { result, after: cloneSim(full) });
          if (p2) return { runs, states: seen.size, violation: p2 };
        }
        const outcomes: Node[] = [{ data: full, trail: [...node.trail, op.label] }];
        for (const [i, crashed] of snapshots.entries()) {
          const k = i + 1;
          // Before the first writer tag exists, a bare up builds an image with
          // no schema (reported separately; see the named hazard test below).
          if (crashed.tags[WRITER] !== undefined) {
            const upped = cloneSim(crashed);
            simBareUp(upped, op.commit);
            outcomes.push({ data: upped, trail: [...node.trail, `${op.label} ✗${k} up`] });
          }
          simReboot(crashed);
          outcomes.push({ data: crashed, trail: [...node.trail, `${op.label} ✗${k} reboot`] });
        }
        for (const o of outcomes) {
          const key = simKey(o.data);
          if (seen.has(key)) continue;
          seen.add(key);
          const props = propertyViolations(o.data);
          if (props.length > 0) {
            return { runs, states: seen.size, violation: `${props[0]} ${at(o.trail)}` };
          }
          next.push(o);
        }
      }
      if (planted) {
        const p2 = await p2Of(node);
        if (p2) return { runs, states: seen.size, violation: p2 };
      }
    }
    frontier = next;
  }
  for (const node of frontier) {
    const p2 = await p2Of(node);
    if (p2) return { runs, states: seen.size, violation: p2 };
  }
  return { runs, states: seen.size, violation: null };
}

describe("ponder deploy crash injection (ADR 0016 §14)", () => {
  for (const legacy of ["ready", "never"] as const) {
    it(`no violation over five runs from a legacy writer that ${legacy === "ready" ? "answers" : "never answers"}`, async () => {
      const result = await explore(legacy);
      assert.equal(result.violation, null);
      assert.ok(result.states > (legacy === "ready" ? 1000 : 10), `explored ${result.states} states`);
      assert.ok(result.runs > result.states);
    });
  }

  const PLANTED: [string, PlantedDeployDefects, Answers][] = [
    ["no write-ahead record", { noWriteAhead: true }, "ready"],
    ["retention dropping previous", { retentionDropsPrevious: true }, "ready"],
    ["bootstrap writing state first", { bootstrapWritesStateFirst: true }, "ready"],
    ["first run writing state after an unanswered probe", { firstRunWritesStateUnanswered: true }, "never"],
  ];
  for (const [name, planted, legacy] of PLANTED) {
    it(`constructed: ${name} is red`, async () => {
      const result = await explore(legacy, planted);
      assert.notEqual(result.violation, null, `${name} must be caught`);
    });
  }

  it("a crash after mutation k leaves exactly the snapshot of mutation k", async () => {
    const data = initialSimData("ready");
    await runOnce(data, OPS[0]!, null, undefined);
    for (const op of OPS) {
      const snapshots: SimData[] = [];
      await runOnce(cloneSim(data), op, null, undefined, snapshots);
      assert.ok(snapshots.length > 0);
      for (const [i, snap] of snapshots.entries()) {
        const crashed = cloneSim(data);
        const r = await runOnce(crashed, op, i + 1, undefined);
        assert.equal(r.exit, "crash");
        assert.equal(simKey(crashed), simKey(snap), `${op.label} ✗${i + 1}`);
      }
    }
  });

  it("covers API-only, indexing, never-answer, recreate-fail, rollback and resumption outcomes", async () => {
    const data = initialSimData("ready");
    const seq: [Op, RegExp][] = [
      [OPS[0]!, /deploy_evidence switch=ready status=200/],
      [OPS[1]!, /deploy_evidence outcome=recreated/],
      [OPS[1]!, /deploy_evidence outcome=unchanged/],
      [OPS[2]!, /deploy_evidence switch=catching_up status=503/],
      [OPS[3]!, /deploy_evidence outcome=returned/],
      [OPS[4]!, /deploy_evidence outcome=returned/],
      [OPS[5]!, /deploy_evidence outcome=recreated/],
    ];
    for (const [op, expected] of seq) {
      const r = await runOnce(data, op, null, undefined);
      assert.match(r.lines.join("\n"), expected, `${op.label}: ${r.lines.join(" | ")}`);
      assert.deepEqual(propertyViolations(data), []);
    }
    assert.equal(data.schemas.kargain, undefined, "kargain dropped once outside current and previous");
  });

  it("named hazard: a bare up before the first writer tag leaves a schema-less writer, refused by name", async () => {
    const data = initialSimData("ready");
    simBareUp(data, SIM_COMMITS.c1);
    assert.equal(data.container?.schema, null);
    const r = await runOnce(data, OPS[0]!, null, undefined);
    assert.equal(r.exit, 1);
    assert.ok(r.lines.includes("deploy_state_invalid: first_run_schema_not_legacy"));
    assert.deepEqual(data.violations, []);
    assert.ok(data.schemas.kargain, "the legacy schema is untouched");
  });
});
