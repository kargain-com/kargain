import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DISPUTE_WITHDRAWN_PREFIX,
  isDisputeWithdrawnRecord,
} from "../lib/passport/index-passport-metadata.ts";

describe("isDisputeWithdrawnRecord", () => {
  it("matches D6 convention for last disputer", () => {
    assert.equal(
      isDisputeWithdrawnRecord(
        "discrepancy",
        `${DISPUTE_WITHDRAWN_PREFIX} note`,
        "0xAbc",
        "0xabc",
      ),
      true,
    );
  });

  it("rejects other authors", () => {
    assert.equal(
      isDisputeWithdrawnRecord(
        "discrepancy",
        `${DISPUTE_WITHDRAWN_PREFIX} note`,
        "0xOther",
        "0xabc",
      ),
      false,
    );
  });

  it("rejects non-discrepancy records", () => {
    assert.equal(
      isDisputeWithdrawnRecord(
        "service",
        `${DISPUTE_WITHDRAWN_PREFIX} note`,
        "0xAbc",
        "0xabc",
      ),
      false,
    );
  });
});
