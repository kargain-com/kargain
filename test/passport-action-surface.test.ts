import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import {
  VERIFICATION_INSTANCE,
  deriveChallengeSurface,
  isAvailable,
} from "@/lib/challenge";
import { CUSTODY_UNRESOLVED_CAUSES } from "../lib/custody/normalized-event.ts";
import {
  derivePassportActionSurface,
  editMetadataRefusalCopy,
  resolvePassportEditAccess,
  resolvePassportLocationRefusal,
  type DerivePassportActionSurfaceInput,
} from "../lib/passport/action-surface.ts";
import {
  locationUnresolvedCauseCopy,
  passportAwayActionCopy,
  type DerivePassportPresenceInput,
} from "../lib/passport/presence.ts";

const OWNER = "0x1111111111111111111111111111111111111111";
const VERIFIER = "0x2222222222222222222222222222222222222222";
const WALLET = "0x3333333333333333333333333333333333333333";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSCONFIG = join(ROOT, "tsconfig.test.json");
const VIRTUAL_FIXTURE = join(ROOT, "test/__virtual__/passport-action-surface.fixture.ts");

function challengeHere(wallet: string = WALLET) {
  return deriveChallengeSurface(VERIFICATION_INSTANCE, {
    challenge: null,
    wallet,
    isActiveVerifier: true,
    passportStatus: "VERIFIED",
    owner: OWNER,
    recordedVerifier: VERIFIER,
    opener: "",
    nowSec: 1_700_000_000,
    requireDisputedStatus: true,
  });
}

const HERE_FACTS: DerivePassportPresenceInput = {
  viewChainId: 84532,
  custodyLocked: false,
  ponderCustodyChain: 84532,
};

function baseInput(
  overrides: Partial<DerivePassportActionSurfaceInput> = {},
): DerivePassportActionSurfaceInput {
  return {
    presenceFacts: HERE_FACTS,
    challenge: challengeHere(),
    wallet: WALLET,
    isOwner: true,
    holder: true,
    isActiveVerifier: false,
    status: "VERIFIED",
    listingActive: false,
    ...overrides,
  };
}

const WRITE_KEYS = [
  "editMetadata",
  "verify",
  "appendRecord",
  "ownerClarification",
  "reportDiscrepancy",
  "appendAttestation",
  "open",
  "withdraw",
  "judge",
  "conclude",
] as const;

function compileFixture(source: string): string[] {
  const config = ts.readConfigFile(TSCONFIG, ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  const host = ts.createCompilerHost(parsed.options, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);

  host.readFile = (fileName) =>
    resolve(fileName) === VIRTUAL_FIXTURE ? source : readFile(fileName);
  host.fileExists = (fileName) =>
    resolve(fileName) === VIRTUAL_FIXTURE ? true : fileExists(fileName);
  host.getSourceFile = (fileName, languageVersion) => {
    const text = host.readFile(fileName);
    if (text == null) return undefined;
    return ts.createSourceFile(fileName, text, languageVersion, true);
  };

  const program = ts.createProgram({
    rootNames: [...parsed.fileNames, VIRTUAL_FIXTURE],
    options: { ...parsed.options, noEmit: true },
    host,
  });

  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => resolve(d.file?.fileName ?? "") === VIRTUAL_FIXTURE)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe("derivePassportActionSurface — presence", () => {
  it("blocks every contract-gated write with away when locked", () => {
    const surface = derivePassportActionSurface(
      baseInput({
        presenceFacts: {
          viewChainId: 84532,
          custodyLocked: true,
          ponderCustodyChain: 11155111,
        },
      }),
    );
    assert.equal(surface.presence.status, "away");
    assert.match(surface.presenceCopy, /Return/);
    for (const key of WRITE_KEYS) {
      const gate = surface[key];
      assert.equal(isAvailable(gate), false, key);
      assert.equal(gate.status === "blocked" && gate.cause, "away", key);
      if (gate.status === "blocked" && gate.cause === "away") {
        assert.equal(gate.presence.status, "away", key);
      }
    }
  });

  it("blocks every write with reads_unresolved when lock unread", () => {
    const surface = derivePassportActionSurface(
      baseInput({
        presenceFacts: {
          viewChainId: 84532,
          custodyLocked: undefined,
        },
      }),
    );
    for (const key of WRITE_KEYS) {
      const gate = surface[key];
      assert.equal(isAvailable(gate), false, key);
      assert.equal(
        gate.status === "blocked" && gate.cause,
        "reads_unresolved",
        key,
      );
      if (
        gate.status === "blocked" &&
        gate.blockedBy === "presence" &&
        gate.cause === "reads_unresolved"
      ) {
        assert.equal(gate.presence.status, "location_unread", key);
      }
    }
  });

  it("blocks every write with custody_unresolved when fold incomplete", () => {
    const surface = derivePassportActionSurface(
      baseInput({
        presenceFacts: {
          viewChainId: 84532,
          custodyLocked: false,
          custodyUnresolved: "incomplete_crossing_link",
        },
      }),
    );
    assert.equal(surface.presence.status, "location_unresolved");
    assert.match(surface.presenceCopy, /one side only/);
    for (const key of WRITE_KEYS) {
      const gate = surface[key];
      assert.equal(isAvailable(gate), false, key);
      assert.equal(
        gate.status === "blocked" && gate.cause,
        "custody_unresolved",
        key,
      );
      if (gate.status === "blocked" && gate.cause === "custody_unresolved") {
        assert.equal(gate.presence.status, "location_unresolved", key);
      }
    }
  });

  it("when here, open remains available for VERIFIED non-owner path", () => {
    const surface = derivePassportActionSurface(
      baseInput({
        isOwner: false,
        holder: false,
        status: "VERIFIED",
        challenge: challengeHere(WALLET),
      }),
    );
    assert.equal(isAvailable(surface.open), true);
    assert.equal(isAvailable(surface.editMetadata), false);
    assert.equal(
      surface.editMetadata.status === "blocked" && surface.editMetadata.cause,
      "not_owner",
    );
  });

  it("when here, edit/appendRecord follow owner listing rules", () => {
    const ok = derivePassportActionSurface(baseInput({ status: "UNVERIFIED" }));
    assert.equal(isAvailable(ok.editMetadata), true);
    assert.equal(isAvailable(ok.appendRecord), true);

    const disputed = derivePassportActionSurface(
      baseInput({ status: "DISPUTED" }),
    );
    assert.equal(isAvailable(disputed.editMetadata), false);
    assert.equal(
      disputed.editMetadata.status === "blocked" &&
        disputed.editMetadata.cause,
      "disputed",
    );
  });

  it("when here, discrepancy withheld for holder; attestation for verifier", () => {
    const holder = derivePassportActionSurface(
      baseInput({ isOwner: true, holder: true }),
    );
    assert.equal(isAvailable(holder.reportDiscrepancy), false);

    const stranger = derivePassportActionSurface(
      baseInput({
        isOwner: false,
        holder: false,
        isActiveVerifier: true,
        status: "UNVERIFIED",
      }),
    );
    assert.equal(isAvailable(stranger.reportDiscrepancy), true);
    assert.equal(isAvailable(stranger.verify), true);
    assert.equal(isAvailable(stranger.appendAttestation), true);
  });

  it("producer cannot emit away without presence", () => {
    const diagnostics = compileFixture(`
import type { PassportWriteGate } from "@/lib/passport/action-surface";
const badGate: PassportWriteGate = { status: "blocked", blockedBy: "presence", cause: "away" };
void badGate;
`);
    assert.ok(
      diagnostics.some((d) => d.includes("presence") && d.includes("missing")),
      diagnostics.join("\n"),
    );
  });

  it("consumer branching on cause without the tag stays red for overlapping reads_unresolved", () => {
    const diagnostics = compileFixture(`
import type { PassportWriteGate } from "@/lib/passport/action-surface";
function render(gate: PassportWriteGate) {
  if (gate.status === "blocked" && gate.cause === "reads_unresolved") {
    return gate.presence.status;
  }
  return "ok";
}
void render;
`);
    assert.ok(
      diagnostics.some((d) => d.includes("Property 'presence' does not exist on type")),
      diagnostics.join("\n"),
    );
  });

  it("the same reads_unresolved cause stays distinct under presence vs write tags", () => {
    const presenceSurface = derivePassportActionSurface(
      baseInput({
        presenceFacts: {
          viewChainId: 84532,
          custodyLocked: undefined,
        },
      }),
    );
    assert.equal(presenceSurface.editMetadata.status, "blocked");
    if (
      presenceSurface.editMetadata.status === "blocked" &&
      presenceSurface.editMetadata.blockedBy === "presence"
    ) {
      assert.equal(presenceSurface.editMetadata.cause, "reads_unresolved");
      assert.equal(presenceSurface.editMetadata.presence.status, "location_unread");
      assert.equal(
        presenceSurface.presenceCopy,
        passportAwayActionCopy(presenceSurface.editMetadata.presence),
      );
    }

    const challengeReads = {
      ...challengeHere(WALLET),
      open: { status: "blocked", cause: "reads_unresolved" } as const,
    };
    const writeSurface = derivePassportActionSurface(
      baseInput({
        presenceFacts: HERE_FACTS,
        isOwner: false,
        holder: false,
        challenge: challengeReads,
      }),
    );
    assert.equal(writeSurface.presence.status, "here");
    assert.equal(writeSurface.presenceCopy, "");
    assert.equal(writeSurface.open.status, "blocked");
    if (writeSurface.open.status === "blocked") {
      assert.equal(writeSurface.open.blockedBy, "write");
      assert.equal(writeSurface.open.cause, "reads_unresolved");
    }
  });
});

describe("resolvePassportEditAccess", () => {
  it("allows when here, configured, not disputed, not mode-held", () => {
    const access = resolvePassportEditAccess({
      presenceFacts: HERE_FACTS,
      status: "VERIFIED",
      listingActive: false,
      configured: true,
    });
    assert.equal(access.status, "allow");
  });

  it("refuses not_configured before presence causes", () => {
    const access = resolvePassportEditAccess({
      presenceFacts: { viewChainId: 84532, custodyLocked: undefined },
      status: "VERIFIED",
      listingActive: false,
      configured: false,
    });
    assert.equal(access.status, "refuse");
    assert.equal(access.status === "refuse" && access.cause, "not_configured");
  });

  it("refuses away, reads_unresolved, and custody_unresolved from presence", () => {
    const a = resolvePassportEditAccess({
      presenceFacts: {
        viewChainId: 84532,
        custodyLocked: true,
        ponderCustodyChain: 11155111,
      },
      status: "VERIFIED",
      listingActive: false,
      configured: true,
    });
    assert.equal(a.status === "refuse" && a.cause, "away");

    const u = resolvePassportEditAccess({
      presenceFacts: { viewChainId: 84532, custodyLocked: undefined },
      status: "VERIFIED",
      listingActive: false,
      configured: true,
    });
    assert.equal(u.status === "refuse" && u.cause, "reads_unresolved");

    const f = resolvePassportEditAccess({
      presenceFacts: {
        viewChainId: 84532,
        custodyLocked: false,
        custodyUnresolved: "empty_history",
      },
      status: "VERIFIED",
      listingActive: false,
      configured: true,
    });
    assert.equal(f.status === "refuse" && f.cause, "custody_unresolved");
  });

  it("refuses disputed and listing_active when here", () => {
    const d = resolvePassportEditAccess({
      presenceFacts: HERE_FACTS,
      status: "DISPUTED",
      listingActive: false,
      configured: true,
    });
    assert.equal(d.status === "refuse" && d.cause, "disputed");

    const l = resolvePassportEditAccess({
      presenceFacts: HERE_FACTS,
      status: "VERIFIED",
      listingActive: true,
      configured: true,
    });
    assert.equal(l.status === "refuse" && l.cause, "listing_active");
  });

  it("presence away wins over disputed and listing_active", () => {
    const access = resolvePassportEditAccess({
      presenceFacts: {
        viewChainId: 84532,
        custodyLocked: true,
        ponderCustodyChain: 11155111,
      },
      status: "DISPUTED",
      listingActive: true,
      configured: true,
    });
    assert.equal(access.status === "refuse" && access.cause, "away");
  });
});

describe("cause × surface — §4.21 lines and consequences", () => {
  it("edit refusal copy contains each cause line, while route transit is separated from terminal refusal", () => {
    for (const cause of CUSTODY_UNRESOLVED_CAUSES) {
      const expected = locationUnresolvedCauseCopy(cause);
      const edit = resolvePassportEditAccess({
        presenceFacts: {
          viewChainId: 84532,
          custodyLocked: false,
          custodyUnresolved: cause,
        },
        status: "VERIFIED",
        listingActive: false,
        configured: true,
      });
      assert.equal(edit.status, "refuse");
      if (edit.status === "refuse") {
        assert.equal(edit.cause, "custody_unresolved");
        const body = editMetadataRefusalCopy(edit.cause, edit.presence);
        assert.equal(body, expected, cause);
      }

      const market = resolvePassportLocationRefusal({
        viewChainId: 84532,
        custodyLocked: undefined,
        custodyUnresolved: cause,
      });
      if (cause === "departure_without_arrival") {
        assert.equal(market.status, "transit");
        if (market.status === "transit") {
          assert.equal(market.cause, "departure_without_arrival");
          assert.equal(market.presence.status, "location_unresolved");
          assert.equal(market.presence.cause, cause);
        }
        continue;
      }
      assert.equal(market.status, "refuse", cause);
      if (market.status === "refuse") {
        assert.equal(market.cause, "custody_unresolved", cause);
        assert.equal(market.description, expected, cause);
        assert.equal(market.title, "Passport location is unresolved", cause);
      }
    }
  });

  it("negative control: cause without its line fails the equality", () => {
    const cause = "empty_history" as const;
    const expected = locationUnresolvedCauseCopy(cause);
    const market = resolvePassportLocationRefusal({
      viewChainId: 84532,
      custodyLocked: undefined,
      custodyUnresolved: cause,
    });
    assert.equal(market.status, "refuse");
    if (market.status === "refuse") {
      // Perturb: drop the consequence — must not equal the owner string.
      const withoutConsequence = expected.replace(
        / Actions that depend on custody stay unavailable until the location resolves\./,
        "",
      );
      assert.notEqual(market.description, withoutConsequence);
      assert.equal(market.description, expected);
    }
  });

  it("location refusal never returns a not-found sentinel for any cause", () => {
    for (const cause of CUSTODY_UNRESOLVED_CAUSES) {
      const market = resolvePassportLocationRefusal({
        viewChainId: 84532,
        custodyLocked: undefined,
        custodyUnresolved: cause,
      });
      assert.notEqual(market.status, "ok");
      assert.notEqual(market.status, "not_found" as string);
      if (cause === "departure_without_arrival") {
        assert.equal(market.status, "transit");
        continue;
      }
      assert.equal(market.status, "refuse");
    }
    const unread = resolvePassportLocationRefusal({
      viewChainId: 84532,
      custodyLocked: undefined,
    });
    assert.equal(unread.status, "refuse");
    if (unread.status === "refuse") {
      assert.equal(unread.cause, "reads_unresolved");
      assert.match(unread.description, /chain to answer/i);
    }
  });

  it("marketplace detail route consumes transit as a non-terminal state", () => {
    const src = readFileSync(
      join(ROOT, "app/(identity)/marketplace/[tokenId]/page.tsx"),
      "utf8",
    );
    assert.match(src, /const viewChainId = hintChainId \?\? result\.passport\.chainId/);
    assert.match(src, /const commerceChainId =\s+location\?\.status === "transit" \? null : result\.passport\.custodyChain!/);
    assert.match(src, /location\?\.status === "transit" \? \(/);
    assert.match(src, /transitBridgeChainId=\{result\.passport\.chainId\}/);
    assert.doesNotMatch(src, /transitBridgeChainId=\{viewChainId\}/);
    assert.match(src, /if \(location\.status === "refuse"\) \{/);
  });

  it("passport commerce does not invent a commerce chain during transit", () => {
    const src = readFileSync(
      join(ROOT, "components/passport/passport-commerce.tsx"),
      "utf8",
    );
    assert.doesNotMatch(src, /const activeChainId = commerceChainId \?\? viewChainId/);
    const transitStart = src.indexOf("function TransitPassportCommerce(");
    const transitReturn = src.indexOf("return (", transitStart);
    const transitEnd = src.indexOf("\n}\n\nfunction ResolvedPassportCommerce(", transitStart);
    assert.ok(transitStart >= 0 && transitReturn > transitStart && transitEnd > transitReturn);
    const transitBlock = src.slice(transitStart, transitEnd);
    assert.match(transitBlock, /<PassportBridgePanel/);
    assert.match(transitBlock, /chainId=\{transitBridgeChainId\}/);
    assert.doesNotMatch(transitBlock, /viewChainId/);
    assert.doesNotMatch(transitBlock, /transitBridgeChainId \?\?/);
    assert.doesNotMatch(transitBlock, /leaveChainPermission=\{facts\.leaveChainPermission\}/);
    assert.doesNotMatch(transitBlock, /usePassportCommerceFacts\(/);
    assert.doesNotMatch(transitBlock, /useAuctionDetail\(/);
    assert.doesNotMatch(transitBlock, /<ListingDetailClientIsland/);
    assert.doesNotMatch(transitBlock, /<PassportSellPanel/);
  });

  it("detail view threads a required transit bridge chain only on the no-commerce branch", () => {
    const src = readFileSync(
      join(ROOT, "components/passport/passport-detail-view.tsx"),
      "utf8",
    );
    assert.match(src, /type TransitProps = CommonProps & \{/);
    assert.match(src, /commerceChainId: null;/);
    assert.match(src, /transitBridgeChainId: number;/);
    assert.match(src, /props\.commerceChainId == null \? \(/);
    assert.match(src, /transitBridgeChainId=\{props\.transitBridgeChainId\}/);
    assert.doesNotMatch(src, /transitBridgeChainId=\{.*\?\?.*\}/);
  });
});

describe("editMetadataRefusalCopy", () => {
  it("reuses presence copy and names other causes", () => {
    const awayAccess = resolvePassportEditAccess({
      presenceFacts: {
        viewChainId: 84532,
        custodyLocked: true,
        ponderCustodyChain: 11155111,
      },
      status: "VERIFIED",
      listingActive: false,
      configured: true,
    });
    assert.equal(awayAccess.status, "refuse");
    if (awayAccess.status === "refuse") {
      assert.match(editMetadataRefusalCopy(awayAccess.cause, awayAccess.presence), /Return/);
    }

    const unreadAccess = resolvePassportEditAccess({
      presenceFacts: { viewChainId: 84532, custodyLocked: undefined },
      status: "VERIFIED",
      listingActive: false,
      configured: true,
    });
    assert.equal(unreadAccess.status, "refuse");
    if (unreadAccess.status === "refuse") {
      assert.match(
        editMetadataRefusalCopy(unreadAccess.cause, unreadAccess.presence),
        /chain to answer/i,
      );
    }

    const here = { status: "here" as const };
    assert.match(editMetadataRefusalCopy("disputed", here), /challenge/);
    assert.match(editMetadataRefusalCopy("listing_active", here), /delisting/);
    assert.match(editMetadataRefusalCopy("not_configured", here), /not configured/i);
  });
});

describe("actions panel consumes action-surface", () => {
  it("panel imports derivePassportActionSurface and does not call the deriver", () => {
    const src = readFileSync(
      join(process.cwd(), "components/passport/passport-actions-panel.tsx"),
      "utf8",
    );
    assert.match(src, /derivePassportActionSurface/);
    assert.match(src, /presenceFacts/);
    assert.doesNotMatch(src, /derivePassportPresence/);
    assert.match(src, /isAvailable\(actionSurface\./);
  });

  it("Add record reveals History via revealPassportRecordsTab", () => {
    const src = readFileSync(
      join(process.cwd(), "components/passport/passport-actions-panel.tsx"),
      "utf8",
    );
    assert.match(src, /revealPassportRecordsTab/);
    assert.match(src, /revealPassportRecordsTab\(pathname\)/);
    assert.doesNotMatch(src, /recordAddedSuccess/);
  });

  it("edit route uses resolvePassportEditAccess for location and status refusals", () => {
    const src = readFileSync(
      join(process.cwd(), "app/(identity)/passport/[tokenId]/edit/page.tsx"),
      "utf8",
    );
    assert.match(src, /resolvePassportEditAccess/);
    assert.match(src, /editMetadataRefusalCopy/);
    assert.match(src, /presenceFacts/);
    assert.doesNotMatch(src, /derivePassportPresence/);
    assert.match(src, /NOT_FOUND/);
    assert.match(src, /PONDER_UNAVAILABLE/);
  });

  it("marketplace route uses resolvePassportLocationRefusal", () => {
    const src = readFileSync(
      join(process.cwd(), "app/(identity)/marketplace/[tokenId]/page.tsx"),
      "utf8",
    );
    assert.match(src, /resolvePassportLocationRefusal/);
    assert.doesNotMatch(src, /derivePassportPresence/);
  });
});
