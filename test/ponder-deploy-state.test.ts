import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEPLOY_STATE_INVALID,
  parsePonderDeployState,
  schemaNameForDeploySha,
} from "../scripts/lib/ponder-deploy-state.ts";

describe("ponder-deploy-state", () => {
  it("parses identity/executable-only as pre-cutover", () => {
    const s = parsePonderDeployState({
      identity: "a".repeat(64),
      executable: "b".repeat(64),
    });
    assert.equal(s.preCutover, true);
    assert.equal(s.live, null);
    assert.equal(s.rollback_model, null);
  });

  it("constructed: unknown field → deploy_state_invalid", () => {
    assert.throws(
      () =>
        parsePonderDeployState({
          identity: "a".repeat(64),
          executable: "b".repeat(64),
          extra: true,
        }),
      (err: unknown) =>
        err instanceof Error &&
        err.message.includes(DEPLOY_STATE_INVALID) &&
        err.message.includes("unknown field"),
    );
  });

  it("constructed: bad rollback_model → deploy_state_invalid", () => {
    assert.throws(
      () =>
        parsePonderDeployState({
          identity: "a".repeat(64),
          executable: "b".repeat(64),
          live: {
            slot: "blue",
            schema: "k_" + "a".repeat(40),
          },
          previous: null,
          pending: null,
          rollback_model: "nope",
          lag: null,
          legacy_schema: null,
        }),
      /deploy_state_invalid/,
    );
  });

  it("schemaNameForDeploySha formats k_<40-hex>", () => {
    const sha = "c".repeat(40);
    assert.equal(schemaNameForDeploySha(sha), `k_${sha}`);
  });
});
