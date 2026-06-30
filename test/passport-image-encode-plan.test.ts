import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPassportEncodeAttempts,
  isWithinPassportImageBudget,
  PASSPORT_IMAGE_INITIAL_MAX_EDGE_PX,
  PASSPORT_IMAGE_INITIAL_QUALITY,
  PASSPORT_IMAGE_MIN_MAX_EDGE_PX,
  PASSPORT_IMAGE_MIN_QUALITY,
  PASSPORT_IMAGE_TARGET_MAX_BYTES,
  scaledDimensions,
} from "../lib/passport/passport-image-encode-plan.ts";

describe("isWithinPassportImageBudget", () => {
  it("accepts bytes within 100 KB", () => {
    assert.equal(isWithinPassportImageBudget(100 * 1024), true);
    assert.equal(isWithinPassportImageBudget(1), true);
  });

  it("rejects zero, negative, and over-budget sizes", () => {
    assert.equal(isWithinPassportImageBudget(0), false);
    assert.equal(isWithinPassportImageBudget(-1), false);
    assert.equal(isWithinPassportImageBudget(PASSPORT_IMAGE_TARGET_MAX_BYTES + 1), false);
  });
});

describe("scaledDimensions", () => {
  it("returns original size when within max edge", () => {
    assert.deepEqual(scaledDimensions(800, 600, 1280), { width: 800, height: 600 });
  });

  it("scales down preserving aspect ratio", () => {
    const result = scaledDimensions(4000, 2000, 1280);
    assert.equal(result.width, 1280);
    assert.equal(result.height, 640);
  });
});

describe("buildPassportEncodeAttempts", () => {
  it("returns non-empty attempts for typical photo dimensions", () => {
    const attempts = buildPassportEncodeAttempts(4032, 3024);
    assert.ok(attempts.length > 0);
    assert.equal(attempts[0]!.quality, PASSPORT_IMAGE_INITIAL_QUALITY);
    assert.ok(attempts[0]!.maxEdge <= PASSPORT_IMAGE_INITIAL_MAX_EDGE_PX);
  });

  it("lowers quality before shrinking max edge", () => {
    const attempts = buildPassportEncodeAttempts(1920, 1080);
    const firstEdge = attempts[0]!.maxEdge;
    const sameEdge = attempts.filter((a) => a.maxEdge === firstEdge);
    const nextEdge = attempts.find((a) => a.maxEdge < firstEdge);
    assert.ok(sameEdge.length > 1);
    assert.ok(sameEdge[0]!.quality > sameEdge[sameEdge.length - 1]!.quality);
    assert.ok(nextEdge != null);
    assert.ok(nextEdge.maxEdge < firstEdge);
  });

  it("never goes below minimum quality or edge", () => {
    const attempts = buildPassportEncodeAttempts(8000, 6000);
    for (const attempt of attempts) {
      assert.ok(attempt.quality >= PASSPORT_IMAGE_MIN_QUALITY);
      assert.ok(attempt.maxEdge >= PASSPORT_IMAGE_MIN_MAX_EDGE_PX);
    }
  });
});
