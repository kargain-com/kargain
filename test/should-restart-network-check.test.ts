import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldRestartNetworkCheck } from "../lib/xmtp/should-restart-network-check.ts";

const KEY = "0xabc";

describe("shouldRestartNetworkCheck", () => {
  it("returns false while a check is in flight for the same address", () => {
    assert.equal(
      shouldRestartNetworkCheck(
        { address: KEY, networkChecking: true, networkChecked: false },
        KEY,
      ),
      false,
    );
  });

  it("returns false after a completed check for the same address", () => {
    assert.equal(
      shouldRestartNetworkCheck(
        { address: KEY, networkChecking: false, networkChecked: true },
        KEY,
      ),
      false,
    );
  });

  it("returns true when the same address was never checked", () => {
    assert.equal(
      shouldRestartNetworkCheck(
        { address: KEY, networkChecking: false, networkChecked: false },
        KEY,
      ),
      true,
    );
  });

  it("returns true when the requested address differs from the store", () => {
    assert.equal(
      shouldRestartNetworkCheck(
        { address: KEY, networkChecking: false, networkChecked: true },
        "0xdef",
      ),
      true,
    );
  });

  it("returns true on first mount with no store address", () => {
    assert.equal(
      shouldRestartNetworkCheck(
        { address: null, networkChecking: false, networkChecked: false },
        KEY,
      ),
      true,
    );
  });
});
