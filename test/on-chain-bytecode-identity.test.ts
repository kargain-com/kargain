import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { padHex, type Hex } from "viem";

import {
  fillImmutableSlots,
  linkLibraries,
  stripCborMetadata,
} from "../scripts/lib/on-chain-bytecode-identity.ts";

describe("on-chain bytecode identity helpers", () => {
  it("stripCborMetadata removes solc auxdata by trailing length", () => {
    const body = "11223344";
    const meta = "a26469706673";
    const len = (6).toString(16).padStart(4, "0");
    const code = (`0x${body}${meta}${len}`) as Hex;
    const { body: stripped, metaLen } = stripCborMetadata(code);
    assert.equal(metaLen, 6);
    assert.equal(stripped, `0x${body}`);
  });

  it("fillImmutableSlots writes 32-byte words at starts", () => {
    const zeros = (`0x${"00".repeat(64)}`) as Hex;
    const word = padHex("0x01" as Hex, { size: 32 });
    const filled = fillImmutableSlots(zeros, { "1": [{ start: 0, length: 32 }] }, {
      "1": word,
    });
    assert.equal(filled.slice(2, 66), word.slice(2));
  });

  it("linkLibraries replaces __$ placeholders in hex string", () => {
    const placeholder = "__$" + "a".repeat(34) + "$__";
    assert.equal(placeholder.length, 40);
    const before = "dead";
    const after = "beef";
    const deployed = (`0x${before}${placeholder}${after}`) as Hex;
    const addr = "0x1234567890123456789012345678901234567890" as const;
    const linked = linkLibraries(
      deployed,
      {
        "project/x.sol": {
          Lib: [{ start: 2, length: 20 }],
        },
      },
      { Lib: addr },
    );
    assert.equal(linked, (`0x${before}${addr.slice(2).toLowerCase()}${after}`) as Hex);
  });
});
