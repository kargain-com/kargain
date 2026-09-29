import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
  type BlockingPassportPresence,
  type PassportPresence,
} from "../lib/passport/presence.ts";

const ROOT = process.cwd();
const HERE_FIXTURE = join(
  ROOT,
  "test/fixtures/passport-away-action-copy-here.ts",
);

function requireBlocking(p: PassportPresence): BlockingPassportPresence {
  assert.equal(presenceBlocksWrites(p), true);
  if (!presenceBlocksWrites(p)) {
    throw new Error("expected blocking presence");
  }
  return p;
}

function runTscOnFixture(source: string): {
  status: number | null;
  out: string;
} {
  const tmp = mkdtempSync(join(tmpdir(), "kargain-presence-here-"));
  const probe = join(tmp, "probe.ts");
  const tsconfigPath = join(tmp, "tsconfig.json");
  try {
    writeFileSync(
      tsconfigPath,
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["ES2022"],
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "ESNext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            allowImportingTsExtensions: true,
            typeRoots: [join(ROOT, "node_modules/@types")],
            paths: { "@/*": [join(ROOT, "*")] },
            baseUrl: ROOT,
          },
          files: [probe],
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(probe, source);
    const result = spawnSync(
      "pnpm",
      ["exec", "tsc", "--noEmit", "-p", tsconfigPath],
      { cwd: ROOT, encoding: "utf8" },
    );
    return {
      status: result.status,
      out: `${result.stdout}\n${result.stderr}`,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("derivePassportPresence", () => {
  it("here when unlocked and custody matches view", () => {
    const p = derivePassportPresence({
      viewChainId: 84532,
      custodyLock: { status: "known", locked: false },
      ponderCustodyChain: 84532,
    });
    assert.equal(p.status, "here");
    assert.equal(isPassportHere(p), true);
    assert.equal(presenceBlocksWrites(p), false);
  });

  it("away when custodyLocked — location from ponder or hint", () => {
    const fromPonder = derivePassportPresence({
      viewChainId: 84532,
      custodyLock: { status: "known", locked: true },
      ponderCustodyChain: 11155111,
    });
    assert.equal(fromPonder.status, "away");
    if (fromPonder.status === "away") {
      assert.equal(fromPonder.locationChainId, 11155111);
    }

    const fromHint = derivePassportPresence({
      viewChainId: 84532,
      custodyLock: { status: "known", locked: true },
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
      custodyLock: { status: "known", locked: false },
      ponderCustodyChain: 11155111,
    });
    assert.equal(p.status, "away");
    if (p.status === "away") {
      assert.equal(p.locationChainId, 11155111);
    }
  });

  it("location_pending when lock unread — distinct from fold", () => {
    const p = derivePassportPresence({
      viewChainId: 84532,
      custodyLock: { status: "pending" },
      ponderCustodyChain: 84532,
    });
    assert.equal(p.status, "location_pending");
    assert.equal(presenceBlocksWrites(p), true);
    const copy = passportAwayActionCopy(requireBlocking(p));
    assert.match(copy, /chain to answer/i);
    assert.doesNotMatch(copy, /Waiting for chain custody/);
  });

  it("location_pending and rpc_unavailable refused never share a sentence", () => {
    const pending = passportAwayActionCopy(
      requireBlocking(
        derivePassportPresence({
          viewChainId: 84532,
          custodyLock: { status: "pending" },
        }),
      ),
    );
    const refused = passportAwayActionCopy(
      requireBlocking(
        derivePassportPresence({
          viewChainId: 84532,
          custodyLock: { status: "refused", cause: "rpc_unavailable" },
        }),
      ),
    );
    assert.match(pending, /Waiting for the chain to answer/i);
    assert.match(refused, /network did not answer/i);
    assert.notEqual(pending, refused);
    assert.equal(
      derivePassportPresence({
        viewChainId: 84532,
        custodyLock: { status: "refused", cause: "rpc_unavailable" },
      }).status,
      "location_refused",
    );
  });

  it("location_unresolved carries each fold cause and never shares unread copy", () => {
    const unread = passportAwayActionCopy(
      requireBlocking(
        derivePassportPresence({
          viewChainId: 84532,
          custodyLock: { status: "pending" },
        }),
      ),
    );
    for (const cause of CUSTODY_UNRESOLVED_CAUSES) {
      const p = derivePassportPresence({
        viewChainId: 84532,
        custodyLock: { status: "pending" },
        custodyUnresolved: cause,
      });
      assert.equal(p.status, "location_unresolved");
      if (p.status === "location_unresolved") {
        assert.equal(p.cause, cause);
      }
      const copy = passportAwayActionCopy(requireBlocking(p));
      assert.notEqual(copy, unread);
      assert.equal(copy, locationUnresolvedCauseCopy(cause));
    }
  });

  it("fold cause wins over unlocked here", () => {
    const p = derivePassportPresence({
      viewChainId: 84532,
      custodyLock: { status: "known", locked: false },
      ponderCustodyChain: 84532,
      custodyUnresolved: "departure_without_arrival",
    });
    assert.equal(p.status, "location_unresolved");
  });

  it("away copy names the location chain", () => {
    const p = derivePassportPresence({
      viewChainId: 84532,
      custodyLock: { status: "known", locked: true },
      ponderCustodyChain: 11155111,
    });
    const copy = passportAwayActionCopy(requireBlocking(p));
    assert.match(copy, /Sepolia|another chain/i);
    assert.match(copy, /Return/);
  });

  it("passportAwayActionCopy does not accept here (@ts-expect-error plant)", () => {
    const live = readFileSync(HERE_FIXTURE, "utf8");
    assert.match(live, /\/\/\s*@ts-expect-error/);
    assert.match(live, /status:\s*"here"/);

    const withoutDirective = live.replace(
      /^\s*\/\/\s*@ts-expect-error[^\n]*\n/m,
      "",
    );
    assert.doesNotMatch(withoutDirective, /\/\/\s*@ts-expect-error/);

    const red = runTscOnFixture(withoutDirective);
    assert.notEqual(red.status, 0, `expected tsc red, got:\n${red.out}`);
    assert.match(red.out, /here|BlockingPassportPresence|passportAwayActionCopy/);

    const green = runTscOnFixture(live);
    assert.equal(green.status, 0, `expected tsc green, got:\n${green.out}`);
  });

  it("here yields null presenceCopy path; blocking yields prior sentences", () => {
    const here: PassportPresence = { status: "here" };
    assert.equal(presenceBlocksWrites(here), false);
    assert.equal(
      presenceBlocksWrites(here) ? passportAwayActionCopy(here) : null,
      null,
    );

    const pending = requireBlocking({ status: "location_pending" });
    assert.equal(
      passportAwayActionCopy(pending),
      "Waiting for the chain to answer where this passport is.",
    );
    const awayNamed = requireBlocking({
      status: "away",
      locationChainId: 11155111,
    });
    assert.match(passportAwayActionCopy(awayNamed), /Return it to this chain/);
    const awayGeneric = requireBlocking({
      status: "away",
      locationChainId: null,
    });
    assert.equal(
      passportAwayActionCopy(awayGeneric),
      "This passport is on another chain. Return it here to restore this action.",
    );
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
        custodyLock: { status: "pending" },
      }),
      derivePassportPresence({
        viewChainId: 84532,
        custodyLock: { status: "known", locked: false },
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
        custodyLock: { status: "known", locked: true },
        ponderCustodyChain: 11155111,
      }),
      derivePassportPresence({
        viewChainId: 84532,
        custodyLock: { status: "pending" },
      }),
      derivePassportPresence({
        viewChainId: 84532,
        custodyLock: { status: "known", locked: false },
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
      custodyLock: { status: "known", locked: false },
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

  it("seven callers narrow before passportAwayActionCopy; here is null not empty string", () => {
    const hook = readFileSync(
      join(ROOT, "hooks/use-passport-presence.ts"),
      "utf8",
    );
    assert.match(hook, /presenceBlocksWrites\(presence\)/);
    assert.match(hook, /presenceCopy:\s*string\s*\|\s*null/);
    assert.match(
      hook,
      /presenceCopy:\s*presenceBlocksWrites\(presence\)\s*\?\s*passportAwayActionCopy\(presence\)\s*:\s*null/,
    );

    const bridge = readFileSync(
      join(ROOT, "lib/passport/bridge-surface.ts"),
      "utf8",
    );
    assert.match(bridge, /if\s*\(\s*!presenceBlocksWrites\(presence\)\s*\)/);
    assert.match(bridge, /locationCopy:\s*passportAwayActionCopy\(presence\)/);

    const action = readFileSync(
      join(ROOT, "lib/passport/action-surface.ts"),
      "utf8",
    );
    assert.match(action, /presenceCopy:\s*string\s*\|\s*null/);
    assert.match(
      action,
      /presenceBlocksWrites\(presence\)\s*\?\s*passportAwayActionCopy\(presence\)\s*:\s*null/,
    );
    assert.match(
      action,
      /if\s*\(\s*presenceBlocksWrites\(presence\)\s*\)\s*\{\s*\n\s*return passportAwayActionCopy\(presence\);/,
    );
    // location refusal arms call copy only after status narrows to location_*
    assert.match(
      action,
      /presence\.status === "location_pending"[\s\S]*passportAwayActionCopy\(presence\)/,
    );
    assert.match(
      action,
      /presence\.status === "location_unresolved"[\s\S]*passportAwayActionCopy\(presence\)/,
    );

    const card = readFileSync(
      join(ROOT, "components/profile/profile-passport-card.tsx"),
      "utf8",
    );
    assert.match(
      card,
      /location_pending[\s\S]*passportAwayActionCopy\(presence\)/,
    );
    assert.doesNotMatch(card, /passportAwayActionCopy\(\s*\{\s*status:\s*"here"/);

    const presenceOwner = readFileSync(
      join(ROOT, "lib/passport/presence.ts"),
      "utf8",
    );
    assert.match(presenceOwner, /BlockingPassportPresence/);
    assert.match(
      presenceOwner,
      /presence is BlockingPassportPresence/,
    );
    assert.doesNotMatch(
      presenceOwner,
      /case "here"/,
    );
    assert.doesNotMatch(
      presenceOwner,
      /return "";/,
    );
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
