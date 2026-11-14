/**
 * The step journal (ADR 0016 §e) replays the procedure to the same point:
 * a run driven one host action at a time, in fresh step processes, prints
 * the same lines and leaves the same world as a direct run.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  HostActionRequested,
  JournalDivergence,
  completePendingEntry,
  createJournaledWorld,
  parseObservation,
  type ContainerEffects,
  type DeployJournal,
  type HostResult,
} from "../scripts/lib/ponder-deploy-journal.ts";
import {
  readStateFile,
  writeFileReplacing,
} from "../scripts/lib/ponder-deploy-state.ts";
import {
  runPonderDeploy,
  type DeployOperation,
  type DeployWorld,
} from "../scripts/lib/ponder-deploy-switch.ts";
import {
  SIM_COMMITS,
  SIM_REPO,
  cloneSim,
  initialSimData,
  simBuildBase,
  simKey,
  simWorld,
  type SimCommit,
  type SimData,
} from "./fixtures/ponder-deploy-sim.ts";

/** The `observe` output format of scripts/ponder-deploy.sh. */
async function observeAsShell(world: DeployWorld, images: string[]): Promise<string> {
  const obs = await world.observe(images);
  const out: string[] = [];
  if (obs.container) {
    out.push(`container ${obs.container.id} ${obs.container.imageId}`);
    out.push("container_env PATH=/usr/local/bin");
    if (obs.container.schema !== null) {
      out.push(`container_env DATABASE_SCHEMA=${obs.container.schema}`);
    }
  } else {
    out.push("container_missing");
  }
  for (const ref of images) {
    const img = obs.images[ref];
    if (!img) {
      out.push(`image_missing ${ref}`);
      continue;
    }
    out.push(`image ${ref} ${img.id}`);
    out.push(`image_env ${ref} NODE_VERSION=24.22.1`);
    if (img.schema !== null) out.push(`image_env ${ref} DATABASE_SCHEMA=${img.schema}`);
  }
  if (obs.legacyFile !== null) out.push(`legacy_file ${obs.legacyFile}`);
  return `${out.join("\n")}\n`;
}

async function executeHost(world: DeployWorld, action: string): Promise<HostResult> {
  const [verb, ...args] = action.split(" ");
  const ok = (output = ""): HostResult => ({ status: 0, output });
  switch (verb) {
    case "observe":
      return ok(await observeAsShell(world, args));
    case "derive":
      await world.derive({
        source: args[0]!,
        tag: args[1]!,
        schema: args[2]!,
        commit: args[3] === "legacy" ? null : args[3]!,
        indexing: args[4] === "none" ? null : args[4]!,
        executable: args[5]!,
      });
      return ok();
    case "tag":
      await world.tagWriter(args[0]!);
      return ok();
    case "recreate": {
      const status = await world.recreate();
      return status === 0 ? ok() : { status, output: "recreate failed\n" };
    }
    case "node": {
      const v = await world.writerNodeVersion();
      return v === null ? { status: 1, output: "" } : ok(`${v}\n`);
    }
    case "tags":
      return ok(`${(await world.listRepositoryTags()).join("\n")}\n<none>\n`);
    case "rmi":
      await world.removeImageTag(args[0]!);
      return ok();
    case "prune":
      await world.pruneImages();
      return ok();
    case "delete_legacy_file":
      await world.deleteLegacyFile();
      return ok();
    default:
      throw new Error(`unknown action ${action}`);
  }
}

function containerEffectsOf(world: DeployWorld, out: string[]): ContainerEffects {
  return {
    write: (text) => {
      for (const line of text.split("\n")) if (line !== "") out.push(line);
    },
    readState: () => world.readState(),
    writeState: (s) => world.writeState(s),
    identities: () => world.identities(),
    preflight: async () => ({ code: await world.preflight(), output: "" }),
    probe: (m) => world.probe(m),
    listSchemas: () => world.listSchemas(),
    dropSchema: (s) => world.dropSchema(s),
    readBuildId: (s) => world.readBuildId(s),
  };
}

/** One host loop: each step is a fresh replay from the persisted journal text. */
async function runJournaled(
  data: SimData,
  operation: DeployOperation,
  commit: SimCommit,
): Promise<{ exit: number; lines: string[]; steps: number }> {
  simBuildBase(data, commit);
  const sim = simWorld(data, commit, null);
  const lines: string[] = [];
  let persisted = JSON.stringify({
    operation,
    commit: commit.commit,
    repository: SIM_REPO,
    entries: [],
  } satisfies DeployJournal);
  let pendingResult: HostResult | null = null;
  for (let steps = 1; ; steps++) {
    const journal = JSON.parse(persisted) as DeployJournal;
    if (pendingResult) completePendingEntry(journal, pendingResult);
    const save = (j: DeployJournal) => {
      persisted = JSON.stringify(j);
    };
    save(journal);
    const world = createJournaledWorld(journal, save, containerEffectsOf(sim.world, lines));
    try {
      const exit = await runPonderDeploy(world, {
        operation,
        commit: commit.commit,
        repository: SIM_REPO,
      });
      return { exit, lines, steps };
    } catch (err) {
      if (!(err instanceof HostActionRequested)) throw err;
      pendingResult = await executeHost(sim.world, err.action);
    }
  }
}

async function runDirect(data: SimData, operation: DeployOperation, commit: SimCommit) {
  simBuildBase(data, commit);
  const sim = simWorld(data, commit, null);
  const exit = await runPonderDeploy(sim.world, {
    operation,
    commit: commit.commit,
    repository: SIM_REPO,
  });
  return { exit, lines: sim.lines };
}

describe("ponder-deploy-journal", () => {
  it("a journaled sequence matches the direct procedure line for line", async () => {
    const direct = initialSimData("ready");
    const journaled = cloneSim(direct);
    const seq: [DeployOperation, SimCommit][] = [
      ["deploy", SIM_COMMITS.c1],
      ["deploy", SIM_COMMITS.c2],
      ["deploy", SIM_COMMITS.c2],
      ["deploy", SIM_COMMITS.c3],
      ["deploy", SIM_COMMITS.c4],
      ["rollback", SIM_COMMITS.c1],
    ];
    for (const [op, commit] of seq) {
      const a = await runDirect(direct, op, commit);
      const b = await runJournaled(journaled, op, commit);
      assert.equal(b.exit, a.exit);
      assert.deepEqual(b.lines, a.lines);
      assert.equal(simKey(journaled), simKey(direct));
      assert.ok(b.steps > 1, "host effects go through actions");
    }
  });

  it("a recorded effect that disagrees on replay is a divergence", async () => {
    const data = initialSimData("ready");
    simBuildBase(data, SIM_COMMITS.c1);
    const sim = simWorld(data, SIM_COMMITS.c1, null);
    const journal: DeployJournal = {
      operation: "deploy",
      commit: SIM_COMMITS.c1.commit,
      repository: SIM_REPO,
      entries: [{ effect: "print", args: ["deploy_evidence operation=rollback"], result: null }],
    };
    const world = createJournaledWorld(journal, () => {}, containerEffectsOf(sim.world, []));
    await assert.rejects(
      runPonderDeploy(world, { operation: "deploy", commit: journal.commit, repository: SIM_REPO }),
      JournalDivergence,
    );
  });

  it("resume without a pending host action is a divergence", () => {
    const journal: DeployJournal = {
      operation: "deploy",
      commit: SIM_COMMITS.c1.commit,
      repository: SIM_REPO,
      entries: [],
    };
    assert.throws(
      () => completePendingEntry(journal, { status: 0, output: "" }),
      /no_pending_host_action/,
    );
  });

  it("observation parsing: effective schema is the last DATABASE_SCHEMA; absent images are null", () => {
    const obs = parseObservation(
      [
        "container abc sha256:1",
        "container_env DATABASE_SCHEMA=k_old",
        "container_env DATABASE_SCHEMA=kargain",
        "image kargain-ponder:writer sha256:1",
        "image_env kargain-ponder:writer DATABASE_SCHEMA=kargain",
        "image_missing kargain-ponder:legacy",
        "legacy_file {\"executable\":\"x\"}",
        "",
      ].join("\n"),
      ["kargain-ponder:writer", "kargain-ponder:legacy"],
    );
    assert.deepEqual(obs, {
      container: { id: "abc", imageId: "sha256:1", schema: "kargain" },
      images: {
        "kargain-ponder:writer": { id: "sha256:1", schema: "kargain" },
        "kargain-ponder:legacy": null,
      },
      legacyFile: '{"executable":"x"}',
    });
    assert.deepEqual(parseObservation("container_missing\n", []).container, null);
    assert.throws(() => parseObservation("bogus line\n", []), JournalDivergence);
  });

  it("state file: absent, readable, unreadable; writes replace on rename", () => {
    const dir = mkdtempSync(join(tmpdir(), "ponder-deploy-state-"));
    try {
      const path = join(dir, "state.json");
      assert.deepEqual(readStateFile(path), { kind: "absent" });
      writeFileReplacing(path, "one\n");
      writeFileReplacing(path, "two\n");
      assert.deepEqual(readStateFile(path), { kind: "text", text: "two\n" });
      const asDir = join(dir, "dir");
      mkdirSync(asDir);
      assert.deepEqual(readStateFile(asDir), { kind: "unreadable" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an unreadable state file is deploy_state_invalid: state_unreadable", async () => {
    const data = initialSimData("ready");
    simBuildBase(data, SIM_COMMITS.c1);
    const sim = simWorld(data, SIM_COMMITS.c1, null);
    const before = simKey(data);
    const world: DeployWorld = { ...sim.world, readState: async () => ({ kind: "unreadable" }) };
    const exit = await runPonderDeploy(world, {
      operation: "deploy",
      commit: SIM_COMMITS.c1.commit,
      repository: SIM_REPO,
    });
    assert.equal(exit, 1);
    assert.deepEqual(sim.lines, [
      "deploy_evidence operation=deploy",
      "deploy_state_invalid: state_unreadable",
    ]);
    assert.equal(simKey(data), before);
  });

  it("target recreate non-zero returns to current like an unanswered probe", async () => {
    const data = initialSimData("ready");
    await runDirect(data, "deploy", SIM_COMMITS.c1);
    data.recreateCallCount = 0;
    const r = await runDirect(data, "deploy", SIM_COMMITS.c5);
    assert.equal(r.exit, 1);
    assert.ok(r.lines.some((l) => l.startsWith("ponder_did_not_become_ready:")));
    assert.ok(r.lines.some((l) => l.includes("outcome=returned")));
  });

  it("return recreate non-zero is deploy_return_failed without a further probe", async () => {
    const data = initialSimData("ready");
    await runDirect(data, "deploy", SIM_COMMITS.c1);
    data.recreateCallCount = 0;
    data.failRecreateCalls = [2];
    const r = await runDirect(data, "deploy", SIM_COMMITS.c4);
    assert.equal(r.exit, 1);
    assert.ok(r.lines.some((l) => l.startsWith("ponder_did_not_become_ready:")));
    assert.ok(r.lines.some((l) => l.startsWith("deploy_return_failed:")));
    assert.ok(!r.lines.some((l) => l.includes("outcome=returned")));
  });

  it("first-run recreate non-zero exits 1 without writing state.json", async () => {
    const data = initialSimData("ready");
    data.failRecreateCalls = [1];
    const r = await runDirect(data, "deploy", SIM_COMMITS.c1);
    assert.equal(r.exit, 1);
    assert.ok(r.lines.some((l) => l.startsWith("ponder_did_not_become_ready:")));
    assert.equal(data.stateFile, null);
  });

  it("non-zero status on requireOk host verbs is JournalDivergence", async () => {
    const data = initialSimData("ready");
    simBuildBase(data, SIM_COMMITS.c1);
    const sim = simWorld(data, SIM_COMMITS.c1, null);
    const journal: DeployJournal = {
      operation: "deploy",
      commit: SIM_COMMITS.c1.commit,
      repository: SIM_REPO,
      entries: [],
    };
    const save = (j: DeployJournal) => {
      Object.assign(journal, j);
    };
    const world = createJournaledWorld(journal, save, containerEffectsOf(sim.world, []));
    let action: string | null = null;
    try {
      await runPonderDeploy(world, {
        operation: "deploy",
        commit: SIM_COMMITS.c1.commit,
        repository: SIM_REPO,
      });
    } catch (err) {
      if (err instanceof HostActionRequested) action = err.action;
      else throw err;
    }
    assert.ok(action?.startsWith("observe "));
    completePendingEntry(journal, { status: 7, output: "boom\n" });
    const world2 = createJournaledWorld(journal, save, containerEffectsOf(sim.world, []));
    await assert.rejects(
      runPonderDeploy(world2, {
        operation: "deploy",
        commit: SIM_COMMITS.c1.commit,
        repository: SIM_REPO,
      }),
      (err: unknown) =>
        err instanceof JournalDivergence && err.message === "deploy_journal_divergence: observe_status_7",
    );
  });
});
