/**
 * 125% artifact headroom extend plan — pins founder-approved ADDITIONAL_BYTES math.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  planProgramExtend,
  rentDeltaLamports,
  targetCapacityAtArtifactHeadroom,
} from "../scripts/lib/svm-program-extend-plan.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("svm-program-extend-plan-policy", () => {
  it("pins 125% targets for the four measured S9-B artifacts", () => {
    assert.equal(targetCapacityAtArtifactHeadroom(262016), 327520);
    assert.equal(targetCapacityAtArtifactHeadroom(223904), 279880);
    assert.equal(targetCapacityAtArtifactHeadroom(107584), 134480);
    assert.equal(targetCapacityAtArtifactHeadroom(148544), 185680);

    const passport = planProgramExtend({
      deployedCapacityBytes: 191128,
      artifactBytes: 262016,
    });
    assert.equal(passport.skip, false);
    if (passport.skip) throw new Error("expected extend");
    assert.equal(passport.additionalBytes, 136392);

    const gateway = planProgramExtend({
      deployedCapacityBytes: 218192,
      artifactBytes: 223904,
    });
    assert.equal(gateway.skip, false);
    if (gateway.skip) throw new Error("expected extend");
    assert.equal(gateway.additionalBytes, 61688);
  });

  it("skips when deployed capacity already meets 125% target", () => {
    const skip = planProgramExtend({
      deployedCapacityBytes: 327520,
      artifactBytes: 262016,
    });
    assert.equal(skip.skip, true);
    assert.equal(skip.additionalBytes, 0);
  });

  it("rent delta is to − from (not a invented constant)", () => {
    assert.equal(
      rentDeltaLamports({
        rentExemptFromLamports: 1_000_000,
        rentExemptToLamports: 1_500_000,
      }),
      500_000,
    );
    assert.throws(
      () =>
        rentDeltaLamports({
          rentExemptFromLamports: 2,
          rentExemptToLamports: 1,
        }),
      /to-rent/,
    );
  });

  it("CLI consumes plan owner and never wires into upgrade auto-extend", () => {
    const extendCli = readFileSync(
      join(ROOT, "scripts/svm-program-extend.ts"),
      "utf8",
    );
    assert.match(extendCli, /planProgramExtend/);
    assert.match(extendCli, /rentDeltaLamports/);
    assert.match(extendCli, /program\",\s*\"extend\"/);

    const upgrade = readFileSync(
      join(ROOT, "scripts/svm-upgrade-in-place.ts"),
      "utf8",
    );
    assert.match(upgrade, /--no-auto-extend/);
    assert.doesNotMatch(upgrade, /svm-program-extend/);
    assert.doesNotMatch(upgrade, /planProgramExtend/);
  });
});
