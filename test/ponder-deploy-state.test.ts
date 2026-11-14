/**
 * ADR 0016 §f: every `deploy_state_invalid` cause is named and changes
 * nothing; §i rollback refusals; §k evidence order of a switch.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseDeployState,
  serializeDeployState,
  type DeployRef,
  type DeployState,
} from "../scripts/lib/ponder-deploy-state.ts";
import {
  runPonderDeploy,
  type DeployOperation,
} from "../scripts/lib/ponder-deploy-switch.ts";
import {
  DEPLOY,
  SIM_COMMITS,
  SIM_REPO,
  WRITER,
  initialSimData,
  simBuildBase,
  simKey,
  simWorld,
  type SimCommit,
  type SimData,
} from "./fixtures/ponder-deploy-sim.ts";

async function run(
  data: SimData,
  operation: DeployOperation = "deploy",
  commit: SimCommit = SIM_COMMITS.c1,
) {
  simBuildBase(data, commit);
  const sim = simWorld(data, commit, null);
  const exit = await runPonderDeploy(sim.world, {
    operation,
    commit: commit.commit,
    repository: SIM_REPO,
  });
  return { exit, lines: sim.lines };
}

/** Legacy adopted, then c1 deployed: current c1, previous legacy. */
async function settled(): Promise<SimData> {
  const data = initialSimData("ready");
  const r = await run(data);
  assert.equal(r.exit, 0, r.lines.join("\n"));
  return data;
}

function state(data: SimData): DeployState {
  return parseDeployState(data.stateFile!, SIM_REPO);
}

async function assertInvalid(
  data: SimData,
  detail: string,
  operation: DeployOperation = "deploy",
): Promise<void> {
  simBuildBase(data, SIM_COMMITS.c2);
  const before = simKey(data);
  const r = await run(data, operation, SIM_COMMITS.c2);
  assert.equal(r.exit, 1);
  assert.deepEqual(r.lines, [
    `deploy_evidence operation=${operation}`,
    `deploy_state_invalid: ${detail}`,
  ]);
  assert.equal(simKey(data), before, "nothing changes");
}

const withState = (data: SimData, edit: (raw: Record<string, unknown>) => void) => {
  const raw = JSON.parse(data.stateFile!) as Record<string, unknown>;
  edit(raw);
  data.stateFile = JSON.stringify(raw);
};

describe("ponder-deploy-state", () => {
  it("first run adopts legacy, then switches; evidence in §k order", async () => {
    const data = initialSimData("ready");
    const r = await run(data);
    const c1 = SIM_COMMITS.c1;
    const schema = `k_${c1.indexing.slice(0, 40)}`;
    assert.deepEqual(r.lines, [
      "deploy_evidence operation=deploy",
      "deploy_evidence adopted=legacy schema=kargain",
      "deploy_evidence ready=ponder status=200",
      "deploy_evidence preflight=ok",
      "deploy_evidence outcome=recreated",
      `deploy_evidence commit=${c1.commit}`,
      `deploy_evidence schema=${schema}`,
      `deploy_evidence indexing=${c1.indexing}`,
      `deploy_evidence executable=${c1.executable}`,
      `deploy_evidence build_id=${c1.buildId}`,
      "deploy_evidence node=v24.22.1",
      "deploy_evidence ready=ponder status=200",
      "deploy_evidence switch=ready status=200",
    ]);
    const s = state(data);
    assert.equal(s.current.commit, c1.commit);
    assert.equal(s.previous?.commit, null);
    assert.equal(s.previous?.image, `${SIM_REPO}:legacy`);
    assert.equal(data.legacyFile, null);
  });

  it("unchanged prints executable, schema, node and ready, then runs retention", async () => {
    const data = await settled();
    const r = await run(data);
    assert.deepEqual(r.lines, [
      "deploy_evidence operation=deploy",
      "deploy_evidence outcome=unchanged",
      `deploy_evidence executable=${SIM_COMMITS.c1.executable}`,
      `deploy_evidence schema=k_${SIM_COMMITS.c1.indexing.slice(0, 40)}`,
      "deploy_evidence node=v24.22.1",
      "deploy_evidence ready=ponder status=200",
    ]);
    assert.equal(r.exit, 0);
  });

  it("an unanswered first-run probe exits 1 without state and keeps the old file", async () => {
    const data = initialSimData("never");
    const r = await run(data);
    assert.equal(r.exit, 1);
    assert.match(r.lines.at(-1)!, /^ponder_did_not_become_ready: /);
    assert.equal(data.stateFile, null);
    assert.notEqual(data.legacyFile, null);
  });

  it("state removed after the first run: deploy_state_invalid: state_absent", async () => {
    const data = await settled();
    data.stateFile = null;
    await assertInvalid(data, "state_absent");
  });

  it("first run refuses a container that is not on kargain", async () => {
    const data = initialSimData("ready");
    data.container = { ...data.container!, schema: null };
    await assertInvalid(data, "first_run_schema_not_legacy");
  });

  it("first run refuses an unreadable old deploy file", async () => {
    const data = initialSimData("ready");
    data.legacyFile = "{";
    await assertInvalid(data, "legacy_file_unparsable");
    data.legacyFile = JSON.stringify({ identity: "x" });
    await assertInvalid(data, "legacy_file_executable");
  });

  const STATE_CAUSES: [string, (raw: Record<string, unknown>) => void][] = [
    ["state_unknown_field_extra", (raw) => (raw.extra = 1)],
    ["state_missing_field_switching", (raw) => delete raw.switching],
    ["current_unknown_field_schema", (raw) => ((raw.current as Record<string, unknown>).schema = "k_x")],
    ["current_missing_field_executable", (raw) => delete (raw.current as Record<string, unknown>).executable],
    ["current_commit", (raw) => ((raw.current as Record<string, unknown>).commit = "HEAD")],
    ["current_indexing", (raw) => ((raw.current as Record<string, unknown>).indexing = "ab")],
    ["current_executable", (raw) => ((raw.current as Record<string, unknown>).executable = null)],
    ["current_image", (raw) => ((raw.current as Record<string, unknown>).image = "other:tag")],
    ["previous_legacy_shape", (raw) => ((raw.previous as Record<string, unknown>).indexing = "a".repeat(64))],
    ["current_not_object", (raw) => (raw.current = null)],
  ];
  for (const [detail, edit] of STATE_CAUSES) {
    it(`deploy_state_invalid: ${detail}`, async () => {
      const data = await settled();
      withState(data, edit);
      await assertInvalid(data, detail);
    });
  }

  it("deploy_state_invalid: state_unparsable", async () => {
    const data = await settled();
    data.stateFile = "{not json";
    await assertInvalid(data, "state_unparsable");
  });

  it("deploy_state_invalid: refs sharing a schema with different indexing", () => {
    const a: DeployRef = {
      commit: "1".repeat(40),
      image: `${SIM_REPO}:${"1".repeat(40)}`,
      indexing: `${"a".repeat(40)}${"0".repeat(24)}`,
      executable: "e".repeat(64),
    };
    const b: DeployRef = {
      ...a,
      commit: "2".repeat(40),
      image: `${SIM_REPO}:${"2".repeat(40)}`,
      indexing: `${"a".repeat(40)}${"1".repeat(24)}`,
    };
    assert.throws(
      () =>
        parseDeployState(
          serializeDeployState({ current: a, previous: b, switching: null }),
          SIM_REPO,
        ),
      /deploy_state_invalid: schema_shared_current_previous/,
    );
  });

  it("deploy_state_invalid: a moved writer tag", async () => {
    const data = await settled();
    data.tags[WRITER] = data.tags[DEPLOY]!;
    await assertInvalid(data, "writer_tag_moved");
  });

  it("deploy_state_invalid: a missing writer tag or container", async () => {
    const a = await settled();
    delete a.tags[WRITER];
    await assertInvalid(a, "writer_tag_missing");
    const b = await settled();
    b.container = null;
    await assertInvalid(b, "writer_container_missing");
  });

  it("deploy_state_invalid: a container on another image than the writer tag", async () => {
    const data = await settled();
    data.container = { ...data.container!, imageId: data.tags[DEPLOY]! };
    await assertInvalid(data, "writer_container_image");
  });

  it("deploy_state_invalid: a DATABASE_SCHEMA override on the container", async () => {
    const data = await settled();
    data.container = { ...data.container!, schema: "kargain" };
    await assertInvalid(data, "schema_override");
  });

  it("deploy_state_invalid: a writer image whose schema is not current's", async () => {
    const data = await settled();
    const s = state(data);
    // current names c3's indexing while its tag points at the running c1 image.
    data.tags[`${SIM_REPO}:${SIM_COMMITS.c3.commit}`] = data.tags[WRITER]!;
    withState(data, (raw) => {
      raw.current = {
        ...s.current,
        commit: SIM_COMMITS.c3.commit,
        image: `${SIM_REPO}:${SIM_COMMITS.c3.commit}`,
        indexing: SIM_COMMITS.c3.indexing,
      };
    });
    await assertInvalid(data, "schema_mismatch");
  });

  it("deploy_state_invalid: current or previous image missing", async () => {
    const a = await settled();
    delete a.tags[state(a).current.image];
    await assertInvalid(a, "current_image_missing");
    const b = await settled();
    delete b.tags[state(b).previous!.image];
    await assertInvalid(b, "previous_image_missing");
  });

  it("rollback: no_previous and previous_image_missing", async () => {
    const data = initialSimData("ready");
    await run(data, "rollback");
    assert.equal(state(data).previous, null);
    const r = await run(data, "rollback");
    assert.deepEqual(r.lines.slice(-1), ["deploy_rollback_failed: no_previous"]);
    const b = await settled();
    delete b.tags[state(b).previous!.image];
    const r2 = await run(b, "rollback");
    assert.deepEqual(r2.lines.slice(-1), ["deploy_rollback_failed: previous_image_missing"]);
  });

  it("rollback switches to previous without preflight; previous becomes the ref rolled back from", async () => {
    const data = await settled();
    const before = state(data);
    const r = await run(data, "rollback");
    assert.equal(r.exit, 0);
    assert.equal(r.lines.includes("deploy_evidence preflight=ok"), false);
    assert.ok(r.lines.includes("deploy_evidence commit=legacy"));
    assert.ok(r.lines.includes("deploy_evidence indexing=none"));
    const after = state(data);
    assert.deepEqual(after.current, before.previous);
    assert.deepEqual(after.previous, before.current);
  });

  it("a never-answering commit returns to current with returned evidence and exit 1", async () => {
    const data = await settled();
    const before = state(data);
    const r = await run(data, "deploy", SIM_COMMITS.c4);
    assert.equal(r.exit, 1);
    const tail = r.lines.slice(r.lines.indexOf("deploy_evidence outcome=returned"));
    assert.deepEqual(tail, [
      "deploy_evidence outcome=returned",
      `deploy_evidence commit=${before.current.commit}`,
      `deploy_evidence schema=k_${SIM_COMMITS.c1.indexing.slice(0, 40)}`,
      "deploy_evidence ready=ponder status=200",
    ]);
    assert.ok(r.lines.some((l) => l.startsWith("ponder_did_not_become_ready: ")));
    assert.deepEqual(state(data), before);
    assert.equal(data.schemas[`k_${SIM_COMMITS.c4.indexing.slice(0, 40)}`], undefined);
  });
});
