import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isHeicFile,
  shouldSkipPassportImageCompression,
  PASSPORT_IMAGE_MAX_EDGE_PX,
  PASSPORT_IMAGE_SKIP_MAX_BYTES,
} from "../lib/passport/compress-passport-image.ts";

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

describe("shouldSkipPassportImageCompression", () => {
  it("skips small webp within dimension cap", () => {
    const file = { name: "a.webp", type: "image/webp", size: 100_000 } as File;
    assert.equal(
      shouldSkipPassportImageCompression(file, 1920, 1080),
      true,
    );
  });

  it("does not skip large jpeg", () => {
    const file = {
      name: "a.jpg",
      type: "image/jpeg",
      size: PASSPORT_IMAGE_SKIP_MAX_BYTES + 1,
    } as File;
    assert.equal(
      shouldSkipPassportImageCompression(file, 1920, 1080),
      false,
    );
  });

  it("does not skip png even when small", () => {
    const file = { name: "a.png", type: "image/png", size: 100_000 } as File;
    assert.equal(
      shouldSkipPassportImageCompression(file, 800, 600),
      false,
    );
  });

  it("does not skip when over max edge", () => {
    const file = { name: "a.webp", type: "image/webp", size: 100_000 } as File;
    assert.equal(
      shouldSkipPassportImageCompression(
        file,
        PASSPORT_IMAGE_MAX_EDGE_PX + 100,
        1080,
      ),
      false,
    );
  });
});
