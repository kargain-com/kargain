import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseMaxRequestsPerSecond,
  PONDER_MAX_RPS_DEFAULTS,
  resolveMaxRequestsPerSecond,
} from "../scripts/lib/ponder-max-rps.ts";

describe("parseMaxRequestsPerSecond", () => {
  it("returns undefined for empty or invalid", () => {
    assert.equal(parseMaxRequestsPerSecond(undefined), undefined);
    assert.equal(parseMaxRequestsPerSecond(""), undefined);
    assert.equal(parseMaxRequestsPerSecond("  "), undefined);
    assert.equal(parseMaxRequestsPerSecond("0"), undefined);
    assert.equal(parseMaxRequestsPerSecond("-1"), undefined);
    assert.equal(parseMaxRequestsPerSecond("abc"), undefined);
  });

  it("parses positive finite numbers", () => {
    assert.equal(parseMaxRequestsPerSecond("5"), 5);
    assert.equal(parseMaxRequestsPerSecond(" 10.5 "), 10.5);
  });
});

describe("resolveMaxRequestsPerSecond", () => {
  it("uses per-chain defaults", () => {
    const empty = {} as NodeJS.ProcessEnv;
    assert.equal(resolveMaxRequestsPerSecond(84532, empty), PONDER_MAX_RPS_DEFAULTS[84532]);
    assert.equal(resolveMaxRequestsPerSecond(11155111, empty), PONDER_MAX_RPS_DEFAULTS[11155111]);
    assert.equal(resolveMaxRequestsPerSecond(31337, empty), PONDER_MAX_RPS_DEFAULTS[31337]);
  });

  it("honors PONDER_MAX_RPS_<chainId> override", () => {
    const env = { PONDER_MAX_RPS_11155111: "3" } as NodeJS.ProcessEnv;
    assert.equal(resolveMaxRequestsPerSecond(11155111, env), 3);
    assert.equal(resolveMaxRequestsPerSecond(84532, env), 10);
  });

  it("falls back to default when env invalid", () => {
    const env = { PONDER_MAX_RPS_84532: "nope" } as NodeJS.ProcessEnv;
    assert.equal(resolveMaxRequestsPerSecond(84532, env), 10);
  });

  it("fails closed on unknown chain without default", () => {
    assert.throws(
      () => resolveMaxRequestsPerSecond(1, {} as NodeJS.ProcessEnv),
      /No PONDER_MAX_RPS default for chain 1/,
    );
  });
});
