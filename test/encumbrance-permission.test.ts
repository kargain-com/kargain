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
  ENCUMBRANCE_PERMISSION_BLOCKED_CAUSES,
  encumbrancePermissionCopy,
  encumbrancePermissionFromSupport,
  encumbranceUnanswerableKnownAddress,
  isEncumbrancePermissionAvailable,
  type EncumbrancePermissionGate,
} from "../lib/passport/encumbrance-permission.ts";
import type { KeyedEntry } from "../lib/web3/keyed-multicall.ts";
import { mintProtocolOwner } from "../lib/web3/protocol-address.ts";

const SOURCE_HEX = "0x1111111111111111111111111111111111111111" as const;
const SOURCE = mintProtocolOwner(84_532, SOURCE_HEX)!;
const KNOWN_SOURCE = { presence: "known" as const, address: SOURCE };

function sourceUnanswerableEntry(): KeyedEntry {
  const raw = encodeErrorResult({
    abi: KarPassportAbi,
    errorName: "SourceUnanswerable",
    args: [SOURCE_HEX],
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

  it("names the source on SourceUnanswerable as known presence", () => {
    const gate = deriveEncumbrancePermission(sourceUnanswerableEntry(), {
      namespace: 84_532,
    });
    assert.equal(gate.status, "blocked");
    assert.equal(
      gate.status === "blocked" && gate.cause,
      "source_unanswerable",
    );
    assert.deepEqual(
      gate.status === "blocked" &&
        gate.cause === "source_unanswerable" &&
        gate.source,
      KNOWN_SOURCE,
    );
    assert.equal(encumbranceUnanswerableKnownAddress(gate), SOURCE);
  });

  it("stays reads_unresolved on SourceUnanswerable without namespace", () => {
    assert.deepEqual(deriveEncumbrancePermission(sourceUnanswerableEntry()), {
      status: "blocked",
      cause: "reads_unresolved",
    });
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
    const unanswerable = deriveEncumbrancePermission(
      sourceUnanswerableEntry(),
      { namespace: 84_532 },
    );
    const unresolved = deriveEncumbrancePermission(undefined);
    assert.notDeepEqual(refused, unanswerable);
    assert.notDeepEqual(refused, unresolved);
    assert.notDeepEqual(unanswerable, unresolved);
  });
});

describe("encumbrancePermissionCopy", () => {
  it("surfaces the source address on known unanswerable", () => {
    const gate: EncumbrancePermissionGate = {
      status: "blocked",
      cause: "source_unanswerable",
      source: KNOWN_SOURCE,
    };
    const copy = encumbrancePermissionCopy(gate, "openConsignment");
    assert.match(copy, /0x1111/);
    assert.match(copy, /could not answer/i);
    assert.match(copy, /Governance/);
  });

  it("names not_carried_by_vm and simulate causes without inventing an address", () => {
    const absent: EncumbrancePermissionGate = {
      status: "blocked",
      cause: "source_unanswerable",
      source: { presence: "not_carried_by_vm" },
    };
    const absentCopy = encumbrancePermissionCopy(absent, "leaveChain");
    assert.ok(absentCopy.length > 0);
    assert.match(absentCopy, /does not name which one/i);
    assert.doesNotMatch(absentCopy, /0x/);
    assert.equal(encumbranceUnanswerableKnownAddress(absent), null);
    const expected: Record<
      "fee_payer_required" | "construction" | "simulation_unavailable" | "unmapped_program_error",
      RegExp
    > = {
      fee_payer_required: /Connect a Solana wallet/i,
      construction: /rejected the permission check/i,
      simulation_unavailable: /did not answer whether this action is permitted/i,
      unmapped_program_error: /does not recognize yet/i,
    };
    for (const cause of Object.keys(expected) as (keyof typeof expected)[]) {
      const copy = encumbrancePermissionCopy(
        { status: "blocked", cause },
        "openConsignment",
      );
      assert.ok(copy.length > 0, cause);
      assert.match(copy, expected[cause], cause);
      assert.doesNotMatch(copy, /Waiting/, cause);
    }
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

  it("support causes return non-empty refusal copy (never wait-as-refusal)", () => {
    const expected: Record<
      "product_owner_owed" | "not_in_program" | "authority_only",
      RegExp
    > = {
      product_owner_owed: /does not read this on this network yet/i,
      not_in_program: /does not provide this/i,
      authority_only: /Only the program authority/i,
    };
    for (const cause of Object.keys(expected) as (keyof typeof expected)[]) {
      const copy = encumbrancePermissionCopy(
        { status: "blocked", cause },
        "openConsignment",
      );
      assert.ok(copy.length > 0, cause);
      assert.match(copy, expected[cause], cause);
      assert.doesNotMatch(copy, /Waiting/, cause);
    }
  });

  it("every blocked cause returns a non-empty sentence", () => {
    for (const cause of ENCUMBRANCE_PERMISSION_BLOCKED_CAUSES) {
      const copy = encumbrancePermissionCopy(
        { status: "blocked", cause },
        "openConsignment",
      );
      assert.ok(copy.length > 0, cause);
    }
    const known = encumbrancePermissionCopy(
      {
        status: "blocked",
        cause: "source_unanswerable",
        source: KNOWN_SOURCE,
      },
      "leaveChain",
    );
    const absent = encumbrancePermissionCopy(
      {
        status: "blocked",
        cause: "source_unanswerable",
        source: { presence: "not_carried_by_vm" },
      },
      "leaveChain",
    );
    assert.ok(known.length > 0);
    assert.ok(absent.length > 0);
    assert.notEqual(known, absent);
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
  it("sell panel uses permission copy and closed-cause copy; never hides on empty", () => {
    const src = readFileSync(
      join(process.cwd(), "components/passport/passport-sell-panel.tsx"),
      "utf8",
    );
    assert.match(src, /encumbrancePermissionCopy/);
    assert.match(src, /sellSurfaceClosedCopy/);
    assert.doesNotMatch(
      src,
      /This passport cannot open a consignment right now\./,
    );
    assert.doesNotMatch(src, /if\s*\(\s*copy\s*\)/);
    assert.doesNotMatch(src, /D2/);
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
