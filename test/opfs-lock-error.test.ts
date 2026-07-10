import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isOpfsLockError } from "../lib/xmtp/opfs-lock-error.ts";

describe("isOpfsLockError", () => {
  it("matches OPFS error class names", () => {
    assert.equal(isOpfsLockError(new Error("locked")), false);
    assert.equal(
      isOpfsLockError(Object.assign(new Error("locked"), { name: "OpfsInitializationError" })),
      true,
    );
    assert.equal(
      isOpfsLockError(Object.assign(new Error("not ready"), { name: "OpfsNotInitializedError" })),
      true,
    );
  });
});
