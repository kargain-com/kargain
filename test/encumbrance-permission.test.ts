import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ContractFunctionRevertedError,
  encodeErrorResult,
} from "viem";

import { KarPassportAbi } from "../lib/contracts/abis.generated.ts";
import {
  deriveEncumbrancePermission,
  encumbrancePermissionCopy,
  encumbrancePermissionFromSupport,
  isEncumbrancePermissionAvailable,
  type EncumbrancePermissionGate,
} from "../lib/passport/encumbrance-permission.ts";
import type { KeyedEntry } from "../lib/web3/keyed-multicall.ts";

const SOURCE = "0x1111111111111111111111111111111111111111" as const;

function sourceUnanswerableEntry(): KeyedEntry {
  const raw = encodeErrorResult({
    abi: KarPassportAbi,
    errorName: "SourceUnanswerable",
    args: [SOURCE],
  });
  return {
    status: "refused",
    cause: "evm_call_failed",
    error: new ContractFunctionRevertedError({
      abi: KarPassportAbi,
      data: raw,
      functionName: "may",
    }),
  };
}

describe("deriveEncumbrancePermission", () => {
  it("is available when may returns true", () => {
    const gate = deriveEncumbrancePermission({
      status: "success",
      result: true,
    });
    assert.equal(gate.status, "available");
    assert.equal(isEncumbrancePermissionAvailable(gate), true);
  });

  it("is refused when may returns false", () => {
    const gate = deriveEncumbrancePermission({
      status: "success",
      result: false,
    });
    assert.deepEqual(gate, { status: "blocked", cause: "refused" });
  });

  it("names the source on SourceUnanswerable", () => {
    const gate = deriveEncumbrancePermission(sourceUnanswerableEntry());
    assert.equal(gate.status, "blocked");
    assert.equal(
      gate.status === "blocked" && gate.cause,
      "source_unanswerable",
    );
    assert.equal(
      gate.status === "blocked" &&
        gate.cause === "source_unanswerable" &&
        gate.source,
      SOURCE,
    );
  });

  it("is reads_unresolved when the entry is missing", () => {
    assert.deepEqual(deriveEncumbrancePermission(undefined), {
      status: "blocked",
      cause: "reads_unresolved",
    });
  });

  it("is reads_unresolved on an opaque transport refusal", () => {
    const gate = deriveEncumbrancePermission({
      status: "refused",
      cause: "evm_call_failed",
      error: new Error("network down"),
    });
    assert.deepEqual(gate, {
      status: "blocked",
      cause: "reads_unresolved",
    });
  });

  it("is reads_unresolved while pending", () => {
    const gate = deriveEncumbrancePermission({ status: "pending" });
    assert.deepEqual(gate, {
      status: "blocked",
      cause: "reads_unresolved",
    });
  });

  it("distinguishes unanswerable from refused and unresolved", () => {
    const refused = deriveEncumbrancePermission({
      status: "success",
      result: false,
    });
    const unanswerable = deriveEncumbrancePermission(sourceUnanswerableEntry());
    const unresolved = deriveEncumbrancePermission(undefined);
    assert.notDeepEqual(refused, unanswerable);
    assert.notDeepEqual(refused, unresolved);
    assert.notDeepEqual(unanswerable, unresolved);
  });
});

describe("encumbrancePermissionCopy", () => {
  it("surfaces the source address on unanswerable", () => {
    const gate: EncumbrancePermissionGate = {
      status: "blocked",
      cause: "source_unanswerable",
      source: SOURCE,
    };
    const copy = encumbrancePermissionCopy(gate, "openConsignment");
    assert.match(copy, /0x1111/);
    assert.match(copy, /could not answer/i);
    assert.match(copy, /Governance/);
  });

  it("uses waiting copy for unresolved, not a definite refusal", () => {
    const copy = encumbrancePermissionCopy(
      { status: "blocked", cause: "reads_unresolved" },
      "leaveChain",
    );
    assert.match(copy, /Waiting/);
    assert.doesNotMatch(copy, /cannot/);
  });

  it("uses refused copy without naming a source", () => {
    const copy = encumbrancePermissionCopy(
      { status: "blocked", cause: "refused" },
      "openConsignment",
    );
    assert.match(copy, /cannot open a consignment/);
    assert.doesNotMatch(copy, /0x/);
  });

  it("support causes return empty copy (D2 names them; never wait-as-refusal)", () => {
    for (const cause of [
      "product_owner_owed",
      "not_in_program",
      "authority_only",
    ] as const) {
      const copy = encumbrancePermissionCopy(
        { status: "blocked", cause },
        "openConsignment",
      );
      assert.equal(copy, "", cause);
      assert.doesNotMatch(copy, /Waiting/);
    }
  });
});

describe("encumbrancePermissionFromSupport", () => {
  it("never maps product_owner_owed to reads_unresolved", () => {
    const gate = encumbrancePermissionFromSupport("product_owner_owed");
    assert.deepEqual(gate, {
      status: "blocked",
      cause: "product_owner_owed",
    });
    assert.notEqual(
      (gate as { cause: string }).cause,
      "reads_unresolved",
    );
  });
});

describe("encumbrance permission consume policy", () => {
  it("sell panel uses permission copy and does not invent may refusal", () => {
    const src = readFileSync(
      join(process.cwd(), "components/passport/passport-sell-panel.tsx"),
      "utf8",
    );
    assert.match(src, /encumbrancePermissionCopy/);
    assert.doesNotMatch(
      src,
      /This passport cannot open a consignment right now\./,
    );
  });

  it("bridge panel uses bridgeBlockReasonCopy with unanswerableSource", () => {
    const src = readFileSync(
      join(process.cwd(), "components/passport/passport-bridge-panel.tsx"),
      "utf8",
    );
    assert.match(src, /leaveChainPermission/);
    assert.match(src, /unanswerableSource/);
    assert.doesNotMatch(src, /mayLeaveChain/);
  });

  it("commerce facts expose gates not booleans", () => {
    const src = readFileSync(
      join(process.cwd(), "lib/passport/passport-commerce-facts.ts"),
      "utf8",
    );
    assert.match(src, /openConsignmentPermission/);
    assert.match(src, /leaveChainPermission/);
    assert.match(src, /deriveEncumbrancePermission/);
    assert.match(src, /entry\("mayOpen"\)/);
    assert.doesNotMatch(src, /mayOpenConsignment:/);
    assert.doesNotMatch(src, /mayLeaveChain:/);
  });
});
