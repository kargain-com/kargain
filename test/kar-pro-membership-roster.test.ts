import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activeMembershipChainIds,
  deriveKarProMembershipRoster,
  foldAnyActiveByAddress,
  karProAlreadyActiveElsewhereCopy,
  karProAnyActive,
  karProLeaveNetworkScopeCopy,
  karProNetworkInstrumentLine,
  KAR_PRO_PER_NETWORK_JOIN_DISCLOSURE,
  KAR_PRO_PAYMENTS_NETWORK_SCOPE,
  otherActiveChainIdsFromRoster,
  preferActiveMembershipChainId,
} from "../lib/kar-pro/membership-roster.ts";
import { mapMembershipBatchToActiveByChain } from "../lib/kar-pro/load-membership-roster.ts";
import { proConsignmentsHref, proShowroomHref } from "../lib/kar-pro/pro-showroom-href.ts";
import { agentProfileHref } from "../lib/marketplace/agent-profile-href.ts";

const HUB = 84532;
const SPOKE = 11155111;
const ADDR = "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77" as `0x${string}`;

describe("deriveKarProMembershipRoster", () => {
  it("maps true/false/undefined to active/not_joined/unresolved", () => {
    const activeByChain = new Map<number, boolean | undefined>([
      [HUB, true],
      [SPOKE, false],
    ]);
    const rows = deriveKarProMembershipRoster({
      commercialChainIds: [SPOKE, HUB],
      walletChainId: HUB,
      activeByChain,
    });
    assert.deepEqual(
      rows.map((r) => ({ chainId: r.chainId, status: r.status, current: r.isCurrentWalletChain })),
      [
        { chainId: HUB, status: "active", current: true },
        { chainId: SPOKE, status: "not_joined", current: false },
      ],
    );
  });

  it("marks unread chains unresolved", () => {
    const rows = deriveKarProMembershipRoster({
      commercialChainIds: [HUB, SPOKE],
      walletChainId: null,
      activeByChain: new Map([[HUB, true]]),
    });
    assert.equal(rows.find((r) => r.chainId === SPOKE)?.status, "unresolved");
    assert.equal(rows.every((r) => !r.isCurrentWalletChain), true);
  });

  it("sorts by chainId ascending", () => {
    const rows = deriveKarProMembershipRoster({
      commercialChainIds: [SPOKE, HUB],
      walletChainId: SPOKE,
      activeByChain: new Map([
        [HUB, false],
        [SPOKE, true],
      ]),
    });
    assert.deepEqual(
      rows.map((r) => r.chainId),
      [HUB, SPOKE],
    );
  });
});

describe("membership roster copy", () => {
  it("formats already-active list", () => {
    assert.equal(karProAlreadyActiveElsewhereCopy([]), "");
    assert.match(karProAlreadyActiveElsewhereCopy([HUB]), /Already KarPro on /);
    assert.match(karProAlreadyActiveElsewhereCopy([SPOKE, HUB]), /,/);
  });

  it("formats network instrument and leave scope", () => {
    assert.match(karProNetworkInstrumentLine(HUB), /^Network · /);
    assert.match(karProLeaveNetworkScopeCopy(HUB), /This leave applies only to /);
  });

  it("exposes join and payments disclosures", () => {
    assert.match(KAR_PRO_PER_NETWORK_JOIN_DISCLOSURE, /per network|this network only/i);
    assert.match(KAR_PRO_PAYMENTS_NETWORK_SCOPE, /Verification fee is set per network/);
  });
});

describe("otherActiveChainIdsFromRoster", () => {
  it("returns other active chains excluding current", () => {
    const rows = deriveKarProMembershipRoster({
      commercialChainIds: [HUB, SPOKE],
      walletChainId: HUB,
      activeByChain: new Map([
        [HUB, true],
        [SPOKE, true],
      ]),
    });
    assert.deepEqual(otherActiveChainIdsFromRoster(rows, HUB), [SPOKE]);
    assert.deepEqual(otherActiveChainIdsFromRoster(rows, null), [HUB, SPOKE]);
  });
});

describe("foldAnyActiveByAddress", () => {
  it("ORs true across chains fail-closed on unread", () => {
    const map = foldAnyActiveByAddress({
      addresses: [ADDR, "0x0000000000000000000000000000000000000001"],
      commercialChainIds: [HUB, SPOKE],
      isActiveOnChain: (cid, addr) => {
        if (addr === ADDR.toLowerCase() && cid === HUB) return true;
        if (addr === ADDR.toLowerCase() && cid === SPOKE) return false;
        return undefined;
      },
    });
    assert.equal(map.get(ADDR.toLowerCase()), true);
    assert.equal(map.get("0x0000000000000000000000000000000000000001"), false);
  });
});

describe("karProAnyActive / preferActiveMembershipChainId", () => {
  it("anyActive from roster only", () => {
    const none = deriveKarProMembershipRoster({
      commercialChainIds: [HUB, SPOKE],
      walletChainId: null,
      activeByChain: new Map([
        [HUB, false],
        [SPOKE, false],
      ]),
    });
    assert.equal(karProAnyActive(none), false);
    assert.deepEqual(activeMembershipChainIds(none), []);

    const one = deriveKarProMembershipRoster({
      commercialChainIds: [HUB, SPOKE],
      walletChainId: null,
      activeByChain: new Map([
        [HUB, true],
        [SPOKE, false],
      ]),
    });
    assert.equal(karProAnyActive(one), true);
    assert.deepEqual(activeMembershipChainIds(one), [HUB]);
  });

  it("prefers wallet commercial when active else first active", () => {
    const rows = deriveKarProMembershipRoster({
      commercialChainIds: [HUB, SPOKE],
      walletChainId: SPOKE,
      activeByChain: new Map([
        [HUB, true],
        [SPOKE, true],
      ]),
    });
    assert.equal(preferActiveMembershipChainId(rows, SPOKE), SPOKE);
    assert.equal(preferActiveMembershipChainId(rows, null), HUB);
    assert.equal(preferActiveMembershipChainId(rows, 1), HUB);
  });
});

describe("mapMembershipBatchToActiveByChain", () => {
  it("failure → all unresolved", () => {
    const map = mapMembershipBatchToActiveByChain(ADDR, [HUB, SPOKE], {
      status: "failure",
    });
    assert.equal(map.get(HUB), undefined);
    assert.equal(map.get(SPOKE), undefined);
  });

  it("success maps membership keys without OR", () => {
    const map = mapMembershipBatchToActiveByChain(ADDR, [HUB, SPOKE], {
      status: "success",
      activeByMembership: new Map([
        [`${HUB}-${ADDR.toLowerCase()}`, true],
        [`${SPOKE}-${ADDR.toLowerCase()}`, false],
      ]),
    });
    assert.equal(map.get(HUB), true);
    assert.equal(map.get(SPOKE), false);
  });
});

describe("pro showroom hrefs", () => {
  it("always includes chain query", () => {
    assert.equal(proShowroomHref("acme", HUB), `/pro/acme?chain=${HUB}`);
    assert.equal(
      proConsignmentsHref("acme", SPOKE),
      `/pro/acme/consignments?chain=${SPOKE}`,
    );
  });

  it("agentProfileHref requires chain for showroom", () => {
    assert.equal(agentProfileHref("acme", ADDR, HUB), `/pro/acme?chain=${HUB}`);
    assert.equal(agentProfileHref("acme", ADDR, null), `/profile/${ADDR}`);
    assert.equal(agentProfileHref("", ADDR, HUB), `/profile/${ADDR}`);
  });
});
