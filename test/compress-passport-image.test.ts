import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isHeicFile,
  PASSPORT_IMAGE_TARGET_MAX_BYTES,
} from "../lib/passport/compress-passport-image.ts";
import { PassportImageOptimizeError } from "../lib/passport/passport-image-optimize-error.ts";

describe("isHeicFile", () => {
  it("detects HEIC mime type", () => {
    const file = { name: "photo.jpg", type: "image/heic" } as File;
    assert.equal(isHeicFile(file), true);
  });

  it("detects HEIC extension", () => {
    const file = { name: "IMG_0001.HEIC", type: "" } as File;
    assert.equal(isHeicFile(file), true);
  });

  it("returns false for jpeg", () => {
    const file = { name: "photo.jpg", type: "image/jpeg" } as File;
    assert.equal(isHeicFile(file), false);
  });
});

describe("PASSPORT_IMAGE_TARGET_MAX_BYTES", () => {
  it("is 100 KB", () => {
    assert.equal(PASSPORT_IMAGE_TARGET_MAX_BYTES, 102_400);
  });
});

describe("PassportImageOptimizeError", () => {
  it("formats budget errors with file name", () => {
    const err = new PassportImageOptimizeError("car.jpg", "budget");
    assert.match(err.message, /car\.jpg/i);
    assert.match(err.message, /100 KB/i);
  });
});
