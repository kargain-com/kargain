/**
 * ADR 0015 §i state owner — fail-closed parse and distinct refs.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  DeployStateInvalidError,
  loadDeployState,
  parsePostCutoverState,
  writeDeployState,
} from "../scripts/lib/ponder-deploy-state.js";

const COMMIT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("ponder deploy state", () => {
  it("accepts post-cutover shape", () => {
    const state = parsePostCutoverState({
      live: {
        slot: "blue",
        schema: `k_${COMMIT}`,
        commit: COMMIT,
        executable: "exec",
        image: "kargain-ponder:x",
      },
      spare: {
        schema: "kargain",
        commit: null,
        executable: "exec-legacy",
        image: "kargain-ponder:legacy",
      },
      pending: null,
      nginx_config_digest: "d",
    });
    assert.equal(state.live?.slot, "blue");
    assert.equal(state.spare?.commit, null);
  });

  it("refuses unknown field", () => {
    assert.throws(
      () =>
        parsePostCutoverState({
          live: null,
          spare: null,
          pending: null,
          nginx_config_digest: null,
          phase: "pre_cutover",
        }),
      DeployStateInvalidError,
    );
  });

  it("refuses two refs sharing a slot", () => {
    assert.throws(
      () =>
        parsePostCutoverState({
          live: {
            slot: "blue",
            schema: `k_${COMMIT}`,
            commit: COMMIT,
            executable: "a",
            image: "i1",
          },
          spare: null,
          pending: {
            slot: "blue",
            schema: "k_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            executable: "b",
            image: "i2",
          },
          nginx_config_digest: null,
        }),
      /slots must be distinct/,
    );
  });

  it("pre-cutover file accepted only while pre-cutover observed", () => {
    const dir = mkdtempSync(join(tmpdir(), "ponder-state-"));
    const path = join(dir, "state.json");
    writeFileSync(
      path,
      JSON.stringify({ identity: "id", executable: "exec" }),
    );
    const pre = loadDeployState(path, true);
    assert.equal(pre.kind, "pre_cutover");
    assert.throws(() => loadDeployState(path, false), DeployStateInvalidError);
  });

  it("writeDeployState round-trips", () => {
    const dir = mkdtempSync(join(tmpdir(), "ponder-state-"));
    const path = join(dir, "state.json");
    const state = {
      live: null,
      spare: null,
      pending: null,
      nginx_config_digest: "abc",
    };
    writeDeployState(path, state);
    const loaded = loadDeployState(path, false);
    assert.equal(loaded.kind, "post_cutover");
    assert.deepEqual(loaded.state, state);
  });
});
