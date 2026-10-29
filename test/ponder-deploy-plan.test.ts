/**
 * ADR 0015 / #73 — 12 plan controls: failing assertion text, then green.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ALL_PLAN_CONTROLS } from "./fixtures/ponder-deploy-plan-controls.ts";

describe("ponder deploy plan controls", () => {
  for (const control of ALL_PLAN_CONTROLS) {
    it(control.name, () => {
      control.run();
    });
  }

  it("suite covers exactly the 12 #73 plan behaviours", () => {
    assert.equal(ALL_PLAN_CONTROLS.length, 12);
  });
});
