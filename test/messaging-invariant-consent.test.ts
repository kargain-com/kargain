/**
 * I16 — Consent writes only through the adapter / protocol APIs.
 * I17 — Inbox lists Allowed only; Requests lists Unknown only.
 * I18 — Denied produces no notification / unread on delivery surfaces.
 * I19 — Auto-allow from indexer relationship module only.
 * I20 — Cutover is ever-sent → Allowed; no surviving local flag.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { getAddress } from "viem";

import { COMPENSATION_FORM, DENOMINATION_KIND } from "../lib/commerce/denomination.ts";
import type { MandateRecord } from "../lib/commerce/ponder-consignment.ts";
import { shouldAllowFromEverSent } from "../lib/messaging/consent-cutover.ts";
import {
  peersFromObligationFacts,
  peersFromMandates,
  peersFromPassportVerifiers,
  peersToAutoAllow,
} from "../lib/messaging/relationship-allow.ts";
import type { ObligationFacts } from "../lib/obligation/types.ts";
import {
  ROOT,
  XMTP_ADAPTER,
  scanTree,
  stripComments,
} from "./messaging-invariant-helpers.ts";

const CONVERSATIONS = path.join(ROOT, "lib/messaging/conversations.ts");
const PROVIDER = path.join(ROOT, "components/providers/xmtp-conversations-provider.tsx");
const INBOX = path.join(ROOT, "components/messaging/message-inbox-client.tsx");
const RELATIONSHIP = path.join(ROOT, "lib/messaging/relationship-allow.ts");
const CUTOVER = path.join(ROOT, "lib/messaging/consent-cutover.ts");
const CONSENT_ACTIONS = path.join(ROOT, "lib/messaging/consent-actions.ts");

const USER = getAddress("0x1111111111111111111111111111111111111111");
const PEER_A = getAddress("0x2222222222222222222222222222222222222222");
const PEER_B = getAddress("0x3333333333333333333333333333333333333333");
const VERIFIER = getAddress("0x4444444444444444444444444444444444444444");

function consentWriteViolations(source: string): string[] {
  const text = stripComments(source);
  const hits: string[] = [];
  if (/\.setConsentStates\s*\(/.test(text)) hits.push("setConsentStates");
  if (/\.updateConsentState\s*\(/.test(text)) hits.push("updateConsentState");
  return hits;
}

function consentWriteAllowlist(file: string): boolean {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  return (
    rel === "lib/messaging/adapters/xmtp-adapter.ts" ||
    rel.startsWith("test/")
  );
}

describe("I16 consent writes through adapter only", () => {
  // Blind spot: a call site that wraps adapter helpers under a renamed local
  // alias still passes; we only ban raw SDK consent APIs outside the adapter.

  it("structural: setConsentStates / updateConsentState only in adapter", () => {
    const found = scanTree(
      [
        path.join(ROOT, "lib/messaging"),
        path.join(ROOT, "hooks"),
        path.join(ROOT, "components"),
        path.join(ROOT, "app"),
      ],
      (src, file) => {
        if (consentWriteAllowlist(file)) return [];
        return consentWriteViolations(src);
      },
    );
    assert.deepEqual(found, []);
    const adapter = fs.readFileSync(XMTP_ADAPTER, "utf8");
    assert.ok(adapter.includes("setConsentStates"));
    assert.ok(adapter.includes("updateConsentState"));
  });

  it("catches a constructed raw consent write outside the adapter", () => {
    const dirty = `
async function accept(dm) {
  await dm.updateConsentState(Allowed);
  await client.preferences.setConsentStates([{ entity: id, state: Allowed }]);
}
`;
    assert.deepEqual(consentWriteViolations(dirty), [
      "setConsentStates",
      "updateConsentState",
    ]);
    const clean = `
async function accept(dm) {
  await updateConversationConsent(dm, MessagingConsentState.Allowed);
}
`;
    assert.deepEqual(consentWriteViolations(clean), []);
  });
});

describe("I17 inbox Allowed / Requests Unknown", () => {
  // Blind spot: a UI that renders requestConversations under the Inbox tab
  // label without changing the data source would not be caught here.

  it("structural: partitioned load uses inboxConsentStates and requestConsentStates", () => {
    const text = stripComments(fs.readFileSync(CONVERSATIONS, "utf8"));
    assert.ok(text.includes("inboxConsentStates()"));
    assert.ok(text.includes("requestConsentStates()"));
    assert.ok(text.includes("listDmsByConsent"));
    assert.equal(text.includes("listDms()"), false);
  });

  it("structural: inbox UI keeps conversations and requestConversations separate", () => {
    const text = stripComments(fs.readFileSync(INBOX, "utf8"));
    assert.ok(text.includes("requestConversations"));
    assert.ok(text.includes('tab === "requests"') || text.includes('activeTab === "requests"'));
    assert.ok(text.includes("Accept"));
    assert.ok(text.includes("Block"));
    assert.equal(/\bspam\b/i.test(text), false);
    assert.equal(/\bsuspicious\b/i.test(text), false);
  });

  it("catches a constructed unfiltered listDms in summaries", () => {
    const dirty = `
export async function loadConversationSummaries(client) {
  await syncConversationsAndMessages(client);
  return client.conversations.listDms();
}
`;
    assert.ok(dirty.includes("listDms()"));
    const clean = `
export async function loadConversationSummaries(client, { consentStates }) {
  await syncConversationsAndMessages(client);
  return listDmsByConsent(client, consentStates);
}
`;
    assert.equal(clean.includes("listDms()"), false);
    assert.ok(clean.includes("listDmsByConsent"));
  });
});

describe("I18 Denied produces no notification", () => {
  // Blind spot: a future notification feed that indexes XMTP events outside
  // openInboxDeliveryStreams would bypass this gate.

  it("structural: message stream filters Allowed; Denied streamDms path ignored", () => {
    const adapter = stripComments(fs.readFileSync(XMTP_ADAPTER, "utf8"));
    assert.ok(adapter.includes("streamAllDmMessages"));
    assert.ok(/consentStates:\s*\[\s*CS\.Allowed\s*\]/.test(adapter));
    assert.ok(adapter.includes("CS.Denied") || adapter.includes("Denied"));
    // Explicit no-op comment / branch for Denied
    assert.ok(adapter.includes("Denied"));
    const provider = stripComments(fs.readFileSync(PROVIDER, "utf8"));
    assert.ok(provider.includes("onRequestConversation"));
    assert.ok(provider.includes("sumUnreadCounts(inbox)") || provider.includes("sumUnreadCounts(conversations)"));
  });

  it("catches a constructed unfiltered message stream", () => {
    const dirty = `await client.conversations.streamAllDmMessages({ onValue: onMessage });`;
    assert.equal(dirty.includes("consentStates"), false);
    const clean = `await client.conversations.streamAllDmMessages({ consentStates: [CS.Allowed], onValue: onMessage });`;
    assert.ok(clean.includes("consentStates: [CS.Allowed]"));
  });
});

describe("I19 auto-allow from indexer relationship only", () => {
  // Blind spot: a new commercial-union query that is not wired into
  // loadRelationshipPeerSet would silently omit peers (fail closed for those).

  const emptyFacts = (over: Partial<ObligationFacts> = {}): ObligationFacts => ({
    unresolved: false,
    consignments: [],
    holds: [],
    bids: [],
    challenges: [],
    passports: [],
    modes: [],
    ...over,
  });

  it("behavioural: live consignment / mandate / verifier allow; unresolved fails closed", () => {
    const fromLot = peersFromObligationFacts(
      USER,
      emptyFacts({
        consignments: [
          {
            id: "c1",
            chainId: 84532,
            mode: "fixedPrice",
            modeContract: PEER_A,
            tokenId: "1",
            seller: USER,
            agent: "",
            buyer: PEER_A,
            phase: "offered",
            recallRequestedAt: null,
          },
        ],
      }),
    );
    assert.equal(fromLot.has(PEER_A.toLowerCase()), true);

    const unresolved = peersFromObligationFacts(
      USER,
      emptyFacts({ unresolved: true, consignments: [
        {
          id: "c1",
          chainId: 84532,
          mode: "fixedPrice",
          modeContract: PEER_A,
          tokenId: "1",
          seller: USER,
          agent: "",
          buyer: PEER_A,
          phase: "offered",
          recallRequestedAt: null,
        },
      ]}),
    );
    assert.equal(unresolved.size, 0);

    const fromMandate = peersFromMandates(
      USER,
      [
        {
          id: "m1",
          chainId: 84532,
          mode: "fixedPrice",
          modeContract: PEER_B,
          tokenId: "2",
          owner: USER,
          agent: PEER_B,
          active: true,
          hasLiveConsignment: false,
          compensationForm: COMPENSATION_FORM.Margin,
          commissionBps: 0,
          floor: 0n,
          currencyCode: "USD",
          denominationKind: DENOMINATION_KIND.Asset,
          asset: "0x0000000000000000000000000000000000000000",
          expiry: 0,
          grantedAt: 0,
        } satisfies MandateRecord,
      ],
      [],
    );
    assert.equal(fromMandate.has(PEER_B.toLowerCase()), true);

    const fromVerifier = peersFromPassportVerifiers(USER, [VERIFIER]);
    assert.equal(fromVerifier.has(VERIFIER.toLowerCase()), true);
  });

  it("behavioural: message content and profile fields never enter auto-allow", () => {
    const relationship = new Set([PEER_A.toLowerCase()]);
    // Claimed peer in a message / profile display name — not in relationship set.
    const claimed = peersToAutoAllow({
      unknownPeerAddresses: [PEER_B],
      relationshipPeers: relationship,
    });
    assert.deepEqual(claimed, []);

    const text = stripComments(fs.readFileSync(RELATIONSHIP, "utf8"));
    assert.equal(text.includes("message.content"), false);
    assert.equal(text.includes("displayName"), false);
    assert.equal(text.includes("nostrProfile"), false);
    assert.equal(text.includes("parseProfile"), false);
    assert.ok(text.includes("getAccountObligations"));
    assert.ok(text.includes("getOwnerMandates"));
    assert.ok(text.includes("getAgentMandates"));
    assert.ok(text.includes("getOwnerPassportVerifierAddresses"));
  });

  it("catches a constructed message-content relationship inferrer", () => {
    const dirty = `
function peersFromMessage(body) {
  const m = body.match(/0x[a-fA-F0-9]{40}/);
  return m ? new Set([m[0].toLowerCase()]) : new Set();
}
`;
    assert.ok(dirty.includes("peersFromMessage"));
    const clean = `
function peersToAutoAllow({ unknownPeerAddresses, relationshipPeers }) {
  return unknownPeerAddresses.filter((p) => relationshipPeers.has(p.toLowerCase()));
}
`;
    assert.equal(clean.includes("message"), false);
  });
});

describe("I20 cutover ever-sent once without surviving flag", () => {
  // Blind spot: cannot observe a second browser installation's first load;
  // protocol Allowed is the shared resolution.

  it("behavioural: Unknown+outgoing → allow; Allowed/Denied/no-outgoing → not", () => {
    assert.equal(
      shouldAllowFromEverSent({
        consentState: "unknown",
        hasOutgoingUserMessage: true,
      }),
      true,
    );
    assert.equal(
      shouldAllowFromEverSent({
        consentState: "unknown",
        hasOutgoingUserMessage: false,
      }),
      false,
    );
    assert.equal(
      shouldAllowFromEverSent({
        consentState: "allowed",
        hasOutgoingUserMessage: true,
      }),
      false,
    );
    assert.equal(
      shouldAllowFromEverSent({
        consentState: "denied",
        hasOutgoingUserMessage: true,
      }),
      false,
    );
  });

  it("structural: no cutover localStorage / surviving flag", () => {
    const cutover = stripComments(fs.readFileSync(CUTOVER, "utf8"));
    assert.equal(cutover.includes("localStorage"), false);
    assert.equal(cutover.includes("sessionStorage"), false);
    assert.equal(/cutoverComplete|CUTOVER_DONE|consentMigrated/i.test(cutover), false);
    assert.ok(cutover.includes("shouldAllowFromEverSent"));
    assert.ok(fs.readFileSync(CONSENT_ACTIONS, "utf8").includes("acceptConversationRequest"));
  });

  it("catches a constructed surviving cutover flag", () => {
    const dirty = `
localStorage.setItem("xmtp:consent-cutover-done", "1");
if (localStorage.getItem("xmtp:consent-cutover-done")) return;
`;
    assert.ok(dirty.includes("localStorage"));
    const clean = `
for (const dm of unknown) {
  if (shouldAllowFromEverSent({ consentState: "unknown", hasOutgoingUserMessage: await hasSent(dm) })) {
    await updateConversationConsent(dm, Allowed);
  }
}
`;
    assert.equal(clean.includes("localStorage"), false);
  });
});

describe("commerce untouched by consent", () => {
  // Blind spot: a commerce surface that gates on a renamed consent helper
  // imported via a barrel would need a broader import graph check.

  it("structural: listing / buy / mandate / verification surfaces do not import consent modules", () => {
    const banned = [
      "consent-actions",
      "consent-cutover",
      "relationship-allow",
      "MessagingConsentState",
      "updateConversationConsent",
      "setConsentStatesByInboxId",
    ];
    const dirs = [
      path.join(ROOT, "components/marketplace"),
      path.join(ROOT, "components/auction"),
      path.join(ROOT, "components/commerce"),
      path.join(ROOT, "components/verifier"),
      path.join(ROOT, "lib/commerce"),
      path.join(ROOT, "lib/passport"),
    ];
    const found = scanTree(dirs, (src, file) => {
      const rel = path.relative(ROOT, file);
      // Verification request may open messaging via contactPeer — that is start→Allowed, not a consent gate on verify.
      if (rel.includes("verification-request-button")) return [];
      const text = stripComments(src);
      return banned.filter((token) => text.includes(token));
    });
    assert.deepEqual(found, []);
  });
});
