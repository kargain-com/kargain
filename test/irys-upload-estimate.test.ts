import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  estimateIrysUploadBytes,
  formatUploadSize,
  sumFileBytes,
  BUNDLE_OVERHEAD_BYTES,
} from "../lib/storage/irys-upload-estimate.ts";

describe("estimateIrysUploadBytes", () => {
  it("applies padding and bundle overhead", () => {
    assert.equal(estimateIrysUploadBytes(0), BUNDLE_OVERHEAD_BYTES);
    assert.equal(estimateIrysUploadBytes(1000), Math.ceil(1150) + BUNDLE_OVERHEAD_BYTES);
  });
});

describe("sumFileBytes", () => {
  it("sums file sizes", () => {
    const files = [{ size: 100 }, { size: 250 }] as File[];
    assert.equal(sumFileBytes(files), 350);
  });
});

describe("formatUploadSize", () => {
  it("formats human-readable sizes", () => {
    assert.equal(formatUploadSize(500), "500 B");
    assert.equal(formatUploadSize(2048), "2.0 KB");
    assert.equal(formatUploadSize(2 * 1024 * 1024), "2.0 MB");
  });
});
