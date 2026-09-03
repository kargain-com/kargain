import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CUSTODY_UNRESOLVED_CAUSES } from "../lib/custody/normalized-event.ts";
import {
  derivePassportPresence,
  derivePassportTrustDisplay,
  isPassportHere,
  locationUnresolvedCauseCopy,
  locationUnresolvedCauseCopyTable,
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

  it("location_unread when lock unread — distinct from fold", () => {
    const p = derivePassportPresence({
      viewChainId: 84532,
      custodyLocked: undefined,
      ponderCustodyChain: 84532,
    });
    assert.equal(p.status, "location_unread");
    assert.equal(presenceBlocksWrites(p), true);
    const copy = passportAwayActionCopy(p);
    assert.match(copy, /chain to answer/i);
    assert.doesNotMatch(copy, /Waiting for chain custody/);
  });

  it("location_unresolved carries each fold cause and never shares unread copy", () => {
    const unread = passportAwayActionCopy(
      derivePassportPresence({
        viewChainId: 84532,
        custodyLocked: undefined,
      }),
    );
    for (const cause of CUSTODY_UNRESOLVED_CAUSES) {
      const p = derivePassportPresence({
        viewChainId: 84532,
        custodyLocked: undefined,
        custodyUnresolved: cause,
      });
      assert.equal(p.status, "location_unresolved");
      if (p.status === "location_unresolved") {
        assert.equal(p.cause, cause);
      }
      const copy = passportAwayActionCopy(p);
      assert.notEqual(copy, unread);
      assert.equal(copy, locationUnresolvedCauseCopy(cause));
    }
  });

  it("fold cause wins over unlocked here", () => {
    const p = derivePassportPresence({
      viewChainId: 84532,
      custodyLocked: false,
      ponderCustodyChain: 84532,
      custodyUnresolved: "departure_without_arrival",
    });
    assert.equal(p.status, "location_unresolved");
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

describe("location unresolved copy exhaustiveness", () => {
  it("copy table keys equal CUSTODY_UNRESOLVED_CAUSES sole enumerator", () => {
    const table = locationUnresolvedCauseCopyTable();
    assert.deepEqual(
      Object.keys(table).sort(),
      [...CUSTODY_UNRESOLVED_CAUSES].sort(),
    );
    for (const cause of CUSTODY_UNRESOLVED_CAUSES) {
      const copy = locationUnresolvedCauseCopy(cause);
      assert.ok(copy.includes(table[cause]));
      if (cause === "unknown_namespace") {
        assert.match(copy, /outside the served networks/);
        assert.doesNotMatch(copy, /until the location resolves/);
      } else {
        assert.match(copy, /until the location resolves/);
      }
    }
  });

  it("negative control: injecting a cause without copy fails closed", () => {
    const table = locationUnresolvedCauseCopyTable() as Record<string, string>;
    const phantom = "invented_cause_for_negative_control";
    assert.equal(table[phantom], undefined);
    assert.throws(() => {
      // Simulate a gate that requires every enumerator key to have a line.
      const required = [...CUSTODY_UNRESOLVED_CAUSES, phantom];
      for (const key of required) {
        if (table[key] == null || table[key] === "") {
          throw new Error(`missing copy for ${key}`);
        }
      }
    }, /missing copy for invented_cause_for_negative_control/);
  });
});

describe("collapse ban — no single unresolved status", () => {
  it("owner never returns status unresolved", () => {
    const cases = [
      derivePassportPresence({
        viewChainId: 84532,
        custodyLocked: undefined,
      }),
      derivePassportPresence({
        viewChainId: 84532,
        custodyLocked: false,
        custodyUnresolved: "empty_history",
      }),
    ];
    for (const p of cases) {
      assert.notEqual(
        (p as { status: string }).status,
        "unresolved",
        JSON.stringify(p),
      );
    }
  });

  it("presence module source does not declare collapsed unresolved status", () => {
    const src = readFileSync(
      join(process.cwd(), "lib/passport/presence.ts"),
      "utf8",
    );
    assert.doesNotMatch(src, /status:\s*["']unresolved["']/);
    assert.doesNotMatch(src, /Waiting for chain custody/);
  });
});

describe("derivePassportTrustDisplay", () => {
  it("never asserts live VERIFIED while away or location gap", () => {
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
      derivePassportPresence({
        viewChainId: 84532,
        custodyLocked: false,
        custodyUnresolved: "conflicting_determination",
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

describe("location surface refusals — behaviour", () => {
  it("marketplace and edit helpers refuse every fold cause with §4.21 copy", () => {
    // Behaviour is owned by action-surface — see passport-action-surface suite.
    // This pin keeps passport-ui covering the copy exhaustiveness path.
    for (const cause of CUSTODY_UNRESOLVED_CAUSES) {
      const expected = locationUnresolvedCauseCopy(cause);
      assert.match(expected, /./);
      assert.doesNotMatch(expected, /Waiting for chain custody/);
    }
  });
});

describe("profile tile presence policy", () => {
  it("profile-passport-card withholds verified accent via trust display", () => {
    const src = readFileSync(
      join(process.cwd(), "components/profile/profile-passport-card.tsx"),
      "utf8",
    );
    assert.match(src, /derivePassportTrustDisplay/);
    assert.match(src, /resolvePassportPresence/);
    assert.match(src, /showVerifiedAccent/);
    assert.match(src, /passportAwayActionCopy/);
    assert.doesNotMatch(src, /derivePassportPresence/);
    assert.doesNotMatch(src, /location unread/);
    assert.doesNotMatch(src, /status === ["']VERIFIED["']\s*\n\s*\? ["']border-accent-warm/);
  });
});

describe("detail gallery presence policy", () => {
  it("detail view mounts PassportPresenceGallery with serializable props only", () => {
    const src = readFileSync(
      join(process.cwd(), "components/passport/passport-detail-view.tsx"),
      "utf8",
    );
    assert.match(src, /PassportPresenceGallery/);
    assert.match(src, /custodyUnresolved=\{passport\.custodyUnresolved\}/);
    assert.doesNotMatch(src, /PassportPresenceVerified/);
  });

  it("presence status module uses the presence hook — no deriver", () => {
    const src = readFileSync(
      join(process.cwd(), "components/passport/passport-presence-status.tsx"),
      "utf8",
    );
    assert.match(src, /export function PassportPresenceGallery/);
    assert.match(src, /usePassportPresence/);
    assert.match(src, /custodyUnresolved/);
    assert.doesNotMatch(src, /derivePassportPresence/);
    assert.doesNotMatch(src, /PassportPresenceVerified/);
    assert.doesNotMatch(src, /children:\s*\([^)]*\)\s*=>/);
  });

  it("listing and auction commerce islands consume usePassportPresence", () => {
    for (const rel of [
      "components/marketplace/listing-detail-client-island.tsx",
      "components/auction/auction-detail-client-island.tsx",
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      assert.match(src, /usePassportPresence/, rel);
      assert.match(src, /presenceBlocksWrites/, rel);
      assert.doesNotMatch(src, /derivePassportPresence/, rel);
    }
  });
});
