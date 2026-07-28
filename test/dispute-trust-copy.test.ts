import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  disputeTerminalTimelineLabel,
  disputeTrustCopyKind,
} from "../lib/passport/dispute-trust-copy.ts";

describe("disputeTrustCopyKind", () => {
  it("classifies expire as lapsed while UNVERIFIED", () => {
    assert.equal(
      disputeTrustCopyKind({
        status: "UNVERIFIED",
        hadDispute: true,
        lastDisputeTerminal: "expire",
      }),
      "lapsed",
    );
  });

  it("classifies confirm as upheld while UNVERIFIED", () => {
    assert.equal(
      disputeTrustCopyKind({
        status: "UNVERIFIED",
        hadDispute: true,
        lastDisputeTerminal: "confirm",
      }),
      "upheld",
    );
  });

  it("classifies closed dispute on VERIFIED as previously disputed", () => {
    assert.equal(
      disputeTrustCopyKind({
        status: "VERIFIED",
        hadDispute: true,
        lastDisputeTerminal: "reject",
      }),
      "previously_disputed",
    );
  });
});

describe("disputeTerminalTimelineLabel", () => {
  it("labels expire distinctly from confirm", () => {
    assert.equal(disputeTerminalTimelineLabel("expire"), "Verification lapsed");
    assert.equal(disputeTerminalTimelineLabel("confirm"), "Dispute confirmed");
  });
});
