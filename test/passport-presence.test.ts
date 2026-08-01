import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  derivePassportPresence,
  derivePassportTrustDisplay,
  isPassportHere,
  passportAwayActionCopy,
  presenceBlocksWrites,
} from "../lib/passport/presence.ts";

describe("derivePassportPresence", () => {
  it("here when unlocked and custody matches view", () => {
    const p = derivePassportPresence({
      viewChainId: 84532,
      custodyLocked: false,
      ponderCustodyChain: 84532,
    });
    assert.equal(p.status, "here");
    assert.equal(isPassportHere(p), true);
    assert.equal(presenceBlocksWrites(p), false);
  });

  it("away when custodyLocked — location from ponder or hint", () => {
    const fromPonder = derivePassportPresence({
      viewChainId: 84532,
      custodyLocked: true,
      ponderCustodyChain: 11155111,
    });
    assert.equal(fromPonder.status, "away");
    if (fromPonder.status === "away") {
      assert.equal(fromPonder.locationChainId, 11155111);
    }

    const fromHint = derivePassportPresence({
      viewChainId: 84532,
      custodyLocked: true,
      ponderCustodyChain: 84532,
      locationChainId: 11155111,
    });
    assert.equal(fromHint.status, "away");
    if (fromHint.status === "away") {
      assert.equal(fromHint.locationChainId, 11155111);
    }
  });

  it("away when unlocked but ponder custody is elsewhere", () => {
    const p = derivePassportPresence({
      viewChainId: 84532,
      custodyLocked: false,
      ponderCustodyChain: 11155111,
    });
    assert.equal(p.status, "away");
    if (p.status === "away") {
      assert.equal(p.locationChainId, 11155111);
    }
  });

  it("fail-closes unresolved when lock unread", () => {
    const p = derivePassportPresence({
      viewChainId: 84532,
      custodyLocked: undefined,
      ponderCustodyChain: 84532,
    });
    assert.equal(p.status, "unresolved");
    assert.equal(presenceBlocksWrites(p), true);
    assert.match(passportAwayActionCopy(p), /Waiting/);
  });

  it("away copy names the location chain", () => {
    const p = derivePassportPresence({
      viewChainId: 84532,
      custodyLocked: true,
      ponderCustodyChain: 11155111,
    });
    const copy = passportAwayActionCopy(p);
    assert.match(copy, /Sepolia|another chain/i);
    assert.match(copy, /Return/);
  });
});

describe("derivePassportTrustDisplay", () => {
  it("never asserts live VERIFIED while away or unresolved", () => {
    for (const presence of [
      derivePassportPresence({
        viewChainId: 84532,
        custodyLocked: true,
        ponderCustodyChain: 11155111,
      }),
      derivePassportPresence({
        viewChainId: 84532,
        custodyLocked: undefined,
      }),
    ] as const) {
      const d = derivePassportTrustDisplay(presence, "VERIFIED");
      assert.equal(d.badgeStatus, null);
      assert.equal(d.showVerifiedAccent, false);
      assert.equal(d.showVerifiedFrame, false);
    }
  });

  it("preserves recorded status when here", () => {
    const here = derivePassportPresence({
      viewChainId: 84532,
      custodyLocked: false,
      ponderCustodyChain: 84532,
    });
    const verified = derivePassportTrustDisplay(here, "VERIFIED");
    assert.equal(verified.badgeStatus, "VERIFIED");
    assert.equal(verified.showVerifiedAccent, true);
    assert.equal(verified.showVerifiedFrame, true);

    const unverified = derivePassportTrustDisplay(here, "UNVERIFIED");
    assert.equal(unverified.badgeStatus, "UNVERIFIED");
    assert.equal(unverified.showVerifiedAccent, false);
  });
});

describe("profile tile presence policy", () => {
  it("profile-passport-card withholds verified accent via trust display", () => {
    const src = readFileSync(
      join(process.cwd(), "components/profile/profile-passport-card.tsx"),
      "utf8",
    );
    assert.match(src, /derivePassportTrustDisplay/);
    assert.match(src, /showVerifiedAccent/);
    assert.doesNotMatch(src, /status === ["']VERIFIED["']\s*\n\s*\? ["']border-accent-warm/);
  });
});
