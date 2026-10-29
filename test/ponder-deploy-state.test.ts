/**
 * ADR 0015 §i + Amendment — fail-closed parse and commit↔schema iff.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  DeployStateInvalidError,
  LEGACY_IMAGE,
  isFirstSwitchInProgress,
  loadDeployState,
  parsePostCutoverState,
  writeDeployState,
} from "../scripts/lib/ponder-deploy-state.js";

const COMMIT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("ponder deploy state", () => {
  it("accepts post-cutover shape with legacy spare commit null", () => {
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
        image: LEGACY_IMAGE,
      },
      pending: null,
      nginx_config_digest: "d",
    });
    assert.equal(state.live?.slot, "blue");
    assert.equal(state.spare?.commit, null);
  });

  it("accepts live with commit null when schema is kargain", () => {
    const state = parsePostCutoverState({
      live: {
        slot: "blue",
        schema: "kargain",
        commit: null,
        executable: "exec-legacy",
        image: LEGACY_IMAGE,
      },
      spare: null,
      pending: null,
      nginx_config_digest: "d",
    });
    assert.equal(state.live?.commit, null);
  });

  it("refuses commit null when schema is not kargain", () => {
    assert.throws(
      () =>
        parsePostCutoverState({
          live: {
            slot: "blue",
            schema: `k_${COMMIT}`,
            commit: null,
            executable: "a",
            image: "i1",
          },
          spare: null,
          pending: null,
          nginx_config_digest: null,
        }),
      /null only allowed when schema is kargain/,
    );
  });

  it("refuses non-null commit when schema is kargain", () => {
    assert.throws(
      () =>
        parsePostCutoverState({
          live: null,
          spare: {
            schema: "kargain",
            commit: COMMIT,
            executable: "a",
            image: LEGACY_IMAGE,
          },
          pending: null,
          nginx_config_digest: null,
        }),
      /must be null when schema is kargain/,
    );
  });

  it("accepts first-switch-in-progress (live null, spare legacy)", () => {
    const state = parsePostCutoverState({
      live: null,
      spare: {
        schema: "kargain",
        commit: null,
        executable: "exec-legacy",
        image: LEGACY_IMAGE,
      },
      pending: {
        slot: "blue",
        schema: `k_${COMMIT}`,
        commit: COMMIT,
        executable: "exec",
        image: `kargain-ponder:${COMMIT}`,
      },
      nginx_config_digest: "d",
    });
    assert.equal(isFirstSwitchInProgress(state), true);
  });

  it("accepts live null spare null pending (first hold write)", () => {
    const state = parsePostCutoverState({
      live: null,
      spare: null,
      pending: {
        slot: "blue",
        schema: `k_${COMMIT}`,
        commit: COMMIT,
        executable: "exec",
        image: `kargain-ponder:${COMMIT}`,
      },
      nginx_config_digest: "d",
    });
    assert.equal(state.pending?.slot, "blue");
  });

  it("refuses live null with non-legacy spare", () => {
    assert.throws(
      () =>
        parsePostCutoverState({
          live: null,
          spare: {
            schema: `k_${COMMIT}`,
            commit: COMMIT,
            executable: "a",
            image: "i1",
          },
          pending: null,
          nginx_config_digest: null,
        }),
      /live null with non-legacy spare/,
    );
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

  it("first-switch-in-progress post shape loads under either observation", () => {
    const dir = mkdtempSync(join(tmpdir(), "ponder-state-"));
    const path = join(dir, "state.json");
    const state = {
      live: null,
      spare: {
        schema: "kargain",
        commit: null,
        executable: "exec-legacy",
        image: LEGACY_IMAGE,
      },
      pending: null,
      nginx_config_digest: "d",
    };
    writeDeployState(path, state);
    assert.equal(loadDeployState(path, true).kind, "post_cutover");
    assert.equal(loadDeployState(path, false).kind, "post_cutover");
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
