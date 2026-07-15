/**
 * Vincent F-2.2 — registry descriptor + publishers panel model.
 * Pure fixtures only: no network, no viem client.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VINCENT_REGISTRY } from "../lib/vincent-commons/registry-config.ts";
import {
  buildRegistryPanelModel,
  checkLineageContinuity,
  truncateContentId,
  type PublisherEpochsInput,
  type RegistryEpoch,
} from "../lib/vincent-commons/registry-panel.ts";

const ROOT_A =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ROOT_B =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ROOT_C =
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const ADDRESS_1 = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_2 = "0x2222222222222222222222222222222222222222" as const;
const ADDRESS_3 = "0x3333333333333333333333333333333333333333" as const;

function epoch(
  index: number,
  merkleRoot: string,
  parentRoot: string | null,
): RegistryEpoch {
  return { epoch: index, merkleRoot, parentRoot };
}

describe("VINCENT_REGISTRY descriptor", () => {
  it("pins the CREATE2 registry address", () => {
    assert.equal(
      VINCENT_REGISTRY.registryAddress,
      "0x06667DB3795C70F34b7517D1Af1217D3167BE241",
    );
    assert.match(VINCENT_REGISTRY.registryAddress, /^0x[0-9a-fA-F]{40}$/);
  });

  it("pins Base Sepolia", () => {
    assert.equal(VINCENT_REGISTRY.chainId, 84532);
  });
});

describe("checkLineageContinuity", () => {
  it("accepts a single genesis epoch with null parent", () => {
    assert.equal(checkLineageContinuity([epoch(0, ROOT_A, null)]), true);
  });

  it("accepts a chained lineage", () => {
    assert.equal(
      checkLineageContinuity([
        epoch(0, ROOT_A, null),
        epoch(1, ROOT_B, ROOT_A),
        epoch(2, ROOT_C, ROOT_B),
      ]),
      true,
    );
  });

  it("rejects a non-null genesis parent", () => {
    assert.equal(checkLineageContinuity([epoch(0, ROOT_A, ROOT_B)]), false);
  });

  it("rejects a broken parent link", () => {
    assert.equal(
      checkLineageContinuity([
        epoch(0, ROOT_A, null),
        epoch(1, ROOT_B, ROOT_C),
      ]),
      false,
    );
  });

  it("rejects an empty chain", () => {
    assert.equal(checkLineageContinuity([]), false);
  });
});

describe("buildRegistryPanelModel", () => {
  it("returns an empty model with zero count for no verifiers", () => {
    const model = buildRegistryPanelModel([]);
    assert.deepEqual(model.publishers, []);
    assert.equal(model.zeroEpochCount, 0);
  });

  it("counts zero-epoch verifiers without emitting rows", () => {
    const inputs: PublisherEpochsInput[] = [
      { address: ADDRESS_1, epochCount: 0, epochs: [] },
      { address: ADDRESS_2, epochCount: 0, epochs: [] },
    ];
    const model = buildRegistryPanelModel(inputs);
    assert.deepEqual(model.publishers, []);
    assert.equal(model.zeroEpochCount, 2);
  });

  it("maps publishers with latest root and lineage flag", () => {
    const inputs: PublisherEpochsInput[] = [
      {
        address: ADDRESS_1,
        epochCount: 2,
        epochs: [epoch(0, ROOT_A, null), epoch(1, ROOT_B, ROOT_A)],
      },
      {
        address: ADDRESS_2,
        epochCount: 1,
        epochs: [epoch(0, ROOT_C, ROOT_A)],
      },
      { address: ADDRESS_3, epochCount: 0, epochs: [] },
    ];
    const model = buildRegistryPanelModel(inputs);
    assert.equal(model.publishers.length, 2);
    assert.equal(model.zeroEpochCount, 1);

    const [first, second] = model.publishers;
    assert.equal(first.address, ADDRESS_1);
    assert.equal(first.epochCount, 2);
    assert.equal(first.latestRoot, ROOT_B);
    assert.equal(first.lineageOk, true);

    assert.equal(second.address, ADDRESS_2);
    assert.equal(second.epochCount, 1);
    assert.equal(second.latestRoot, ROOT_C);
    // Non-null genesis parent → broken lineage.
    assert.equal(second.lineageOk, false);
  });

  it("orders by epoch count desc, then address asc", () => {
    const inputs: PublisherEpochsInput[] = [
      { address: ADDRESS_3, epochCount: 1, epochs: [epoch(0, ROOT_A, null)] },
      { address: ADDRESS_1, epochCount: 1, epochs: [epoch(0, ROOT_B, null)] },
      {
        address: ADDRESS_2,
        epochCount: 2,
        epochs: [epoch(0, ROOT_A, null), epoch(1, ROOT_B, ROOT_A)],
      },
    ];
    const model = buildRegistryPanelModel(inputs);
    assert.deepEqual(
      model.publishers.map((row) => row.address),
      [ADDRESS_2, ADDRESS_1, ADDRESS_3],
    );
  });

  it("treats a count/epochs mismatch (RPC partial failure) as no row", () => {
    const inputs: PublisherEpochsInput[] = [
      { address: ADDRESS_1, epochCount: 1, epochs: [] },
    ];
    const model = buildRegistryPanelModel(inputs);
    assert.deepEqual(model.publishers, []);
    assert.equal(model.zeroEpochCount, 1);
  });
});

describe("truncateContentId", () => {
  it("keeps short values intact", () => {
    assert.equal(truncateContentId("sha256:abcd"), "sha256:abcd");
  });

  it("truncates long roots with head and tail", () => {
    const truncated = truncateContentId(ROOT_A);
    assert.equal(truncated, "sha256:aaaaaaa…aaaaaa");
    assert.ok(truncated.length < ROOT_A.length);
  });

  it("truncates 0x addresses beyond 20 chars", () => {
    const truncated = truncateContentId(ADDRESS_1);
    assert.equal(truncated, "0x111111111111…111111");
  });
});
