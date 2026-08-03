import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LWW_RELAY_EOSE_NEUTRAL_MS,
  LWW_RELAY_READ_DEADLINE_MS,
} from "../lib/nostr/app-event-store.ts";
import { OWN_RELAY_TIMEOUT_MS } from "../lib/nostr/publish-event.ts";
import { ATTESTED_PROFILE_CREATED_AT_SKEW_SECONDS } from "../lib/nostr/resolve-attested-profile.ts";

describe("nostr wall-clock budgets (value pins)", () => {
  it("pins historical relay / publish / skew values", () => {
    assert.equal(LWW_RELAY_READ_DEADLINE_MS, 4500);
    assert.equal(LWW_RELAY_EOSE_NEUTRAL_MS, 2_147_483_647);
    assert.equal(OWN_RELAY_TIMEOUT_MS, 4000);
    assert.equal(ATTESTED_PROFILE_CREATED_AT_SKEW_SECONDS, 3600);
  });
});
