import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
} from "viem";

import { KarPassportAbi } from "../lib/contracts/abis.generated.ts";
import { decodeCustomError } from "../lib/web3/decode-custom-error.ts";

const SOURCE = "0x1111111111111111111111111111111111111111" as const;

function sourceUnanswerableRaw(): `0x${string}` {
  return encodeErrorResult({
    abi: KarPassportAbi,
    errorName: "SourceUnanswerable",
    args: [SOURCE],
  });
}

describe("decodeCustomError", () => {
  it("decodes SourceUnanswerable(source) from ContractFunctionRevertedError.data", () => {
    const raw = sourceUnanswerableRaw();
    const reverted = new ContractFunctionRevertedError({
      abi: KarPassportAbi,
      data: raw,
      functionName: "may",
    });
    const decoded = decodeCustomError(reverted, KarPassportAbi);
    assert.equal(decoded?.name, "SourceUnanswerable");
    assert.equal(decoded?.args?.[0], SOURCE);
  });

  it("walks ContractFunctionExecutionError to the inner revert", () => {
    const raw = sourceUnanswerableRaw();
    const inner = new ContractFunctionRevertedError({
      abi: KarPassportAbi,
      data: raw,
      functionName: "may",
    });
    const outer = new ContractFunctionExecutionError(inner, {
      abi: KarPassportAbi,
      functionName: "may",
      args: [1n, 0],
      contractAddress: "0x2222222222222222222222222222222222222222",
      sender: "0x3333333333333333333333333333333333333333",
    });
    const decoded = decodeCustomError(outer, KarPassportAbi);
    assert.equal(decoded?.name, "SourceUnanswerable");
    assert.equal(decoded?.args?.[0], SOURCE);
  });

  it("decodes from raw hex via decodeErrorResult when .data is absent", () => {
    const raw = sourceUnanswerableRaw();
    const decoded = decodeCustomError({ data: raw }, KarPassportAbi);
    assert.equal(decoded?.name, "SourceUnanswerable");
    assert.equal(decoded?.args?.[0], SOURCE);
  });

  it("returns null for an unknown selector", () => {
    // Made-up 4-byte selector + empty args
    const decoded = decodeCustomError(
      { data: "0xdeadbeef0000000000000000000000000000000000000000000000000000000000000000" },
      KarPassportAbi,
    );
    assert.equal(decoded, null);
  });

  it("returns null for a plain transport Error (no revert data)", () => {
    assert.equal(decodeCustomError(new Error("network down"), KarPassportAbi), null);
  });

  it("does not match on message strings", () => {
    const lying = new Error("SourceUnanswerable(0x1111111111111111111111111111111111111111)");
    assert.equal(decodeCustomError(lying, KarPassportAbi), null);
  });
});
