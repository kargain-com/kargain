import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

import {
  COMMISSION_FORM_DEF,
  MARGIN_FORM_DEF,
  lowerCommissionConcessionEffect,
  lowerFloorConcessionEffect,
} from "@/lib/commerce/compensation-form";
import {
  deriveAgentLowerCommissionConcession,
  deriveOwnerLowerFloorConcession,
  isConcessionAvailable,
} from "@/lib/commerce/concession-surface";
import { COMPENSATION_FORM } from "@/lib/commerce/denomination";

const ROOT = join(import.meta.dirname, "..");

describe("deriveOwnerLowerFloorConcession", () => {
  it("is available when live, owner, and snapshot floor are known", () => {
    const gate = deriveOwnerLowerFloorConcession({
      live: true,
      isPassportOwner: true,
      snapshotFloor: 100n,
    });
    assert.equal(isConcessionAvailable(gate), true);
  });

  it("blocks with no_live_consignment when not live", () => {
    const gate = deriveOwnerLowerFloorConcession({
      live: false,
      isPassportOwner: true,
      snapshotFloor: 100n,
    });
    assert.deepEqual(gate, {
      status: "blocked",
      cause: "no_live_consignment",
    });
  });

  it("blocks with not_passport_owner when caller is not owner", () => {
    const gate = deriveOwnerLowerFloorConcession({
      live: true,
      isPassportOwner: false,
      snapshotFloor: 100n,
    });
    assert.deepEqual(gate, {
      status: "blocked",
      cause: "not_passport_owner",
    });
  });

  it("fail-closed reads_unresolved when live is unread", () => {
    const gate = deriveOwnerLowerFloorConcession({
      live: undefined,
      isPassportOwner: true,
      snapshotFloor: 100n,
    });
    assert.deepEqual(gate, {
      status: "blocked",
      cause: "reads_unresolved",
    });
  });

  it("fail-closed when snapshot floor is unread", () => {
    const gate = deriveOwnerLowerFloorConcession({
      live: true,
      isPassportOwner: true,
      snapshotFloor: undefined,
    });
    assert.deepEqual(gate, {
      status: "blocked",
      cause: "reads_unresolved",
    });
  });

  it("blocks no_floor_headroom when floor is already zero", () => {
    const gate = deriveOwnerLowerFloorConcession({
      live: true,
      isPassportOwner: true,
      snapshotFloor: 0n,
    });
    assert.deepEqual(gate, {
      status: "blocked",
      cause: "no_floor_headroom",
    });
  });
});

describe("deriveAgentLowerCommissionConcession", () => {
  it("is available when live, agent, Commission form, and bps known", () => {
    const gate = deriveAgentLowerCommissionConcession({
      live: true,
      isConsignmentAgent: true,
      compensationForm: COMPENSATION_FORM.Commission,
      snapshotCommissionBps: 500,
    });
    assert.equal(isConcessionAvailable(gate), true);
  });

  it("blocks not_commission_form under Margin (contract refuses)", () => {
    const gate = deriveAgentLowerCommissionConcession({
      live: true,
      isConsignmentAgent: true,
      compensationForm: COMPENSATION_FORM.Margin,
      snapshotCommissionBps: 500,
    });
    assert.deepEqual(gate, {
      status: "blocked",
      cause: "not_commission_form",
    });
  });

  it("blocks not_consignment_agent when caller is not agent", () => {
    const gate = deriveAgentLowerCommissionConcession({
      live: true,
      isConsignmentAgent: false,
      compensationForm: COMPENSATION_FORM.Commission,
      snapshotCommissionBps: 500,
    });
    assert.deepEqual(gate, {
      status: "blocked",
      cause: "not_consignment_agent",
    });
  });

  it("blocks no_live_consignment when not live", () => {
    const gate = deriveAgentLowerCommissionConcession({
      live: false,
      isConsignmentAgent: true,
      compensationForm: COMPENSATION_FORM.Commission,
      snapshotCommissionBps: 500,
    });
    assert.deepEqual(gate, {
      status: "blocked",
      cause: "no_live_consignment",
    });
  });

  it("fail-closed when compensation form is unread", () => {
    const gate = deriveAgentLowerCommissionConcession({
      live: true,
      isConsignmentAgent: true,
      compensationForm: undefined,
      snapshotCommissionBps: 500,
    });
    assert.deepEqual(gate, {
      status: "blocked",
      cause: "reads_unresolved",
    });
  });

  it("blocks no_commission_headroom when bps is zero", () => {
    const gate = deriveAgentLowerCommissionConcession({
      live: true,
      isConsignmentAgent: true,
      compensationForm: COMPENSATION_FORM.Commission,
      snapshotCommissionBps: 0,
    });
    assert.deepEqual(gate, {
      status: "blocked",
      cause: "no_commission_headroom",
    });
  });
});

describe("concession effect copy", () => {
  it("composes floor effect from margin definition", () => {
    const effect = lowerFloorConcessionEffect(COMPENSATION_FORM.Margin);
    assert.ok(effect.includes(MARGIN_FORM_DEF.ownerReceives));
  });

  it("composes floor effect from commission definition", () => {
    const effect = lowerFloorConcessionEffect(COMPENSATION_FORM.Commission);
    assert.ok(effect.includes(COMMISSION_FORM_DEF.ownerReceives));
  });

  it("composes commission effect from commission definition", () => {
    const effect = lowerCommissionConcessionEffect();
    assert.ok(effect.includes(COMMISSION_FORM_DEF.agentReceives));
  });
});

describe("concession policy — no mode branch / no miswired mandate lowerFloor", () => {
  it("derive functions do not take a mode parameter", () => {
    const src = readFileSync(
      join(ROOT, "lib/commerce/concession-surface.ts"),
      "utf8",
    );
    assert.ok(!/\bmode\s*:/.test(src));
    assert.ok(!/CommerceMode/.test(src));
  });

  it("agent-authorization-status no longer calls lowerFloor", () => {
    const src = readFileSync(
      join(ROOT, "components/marketplace/agent-authorization-status.tsx"),
      "utf8",
    );
    assert.ok(!/lowerFloor/.test(src));
    assert.ok(!/Lower minimum/.test(src));
  });

  it("both modes mount shared owner floor panel", () => {
    const listing = readFileSync(
      join(ROOT, "components/marketplace/listing-detail-client-island.tsx"),
      "utf8",
    );
    const auction = readFileSync(
      join(ROOT, "components/auction/auction-detail-client-island.tsx"),
      "utf8",
    );
    assert.ok(listing.includes("OwnerLowerFloorPanel"));
    assert.ok(auction.includes("OwnerLowerFloorPanel"));
  });

  it("consigned tab mounts commission panel for ascending", () => {
    const src = readFileSync(
      join(ROOT, "components/profile/consigned-vehicles-tab.tsx"),
      "utf8",
    );
    assert.ok(src.includes("AgentLowerCommissionPanel"));
    assert.ok(src.includes('mode="ascending"'));
  });

  it("agent-update composes shared commission panel (no inline lowerCommission)", () => {
    const src = readFileSync(
      join(ROOT, "components/marketplace/agent-update-listing-panel.tsx"),
      "utf8",
    );
    assert.ok(src.includes("AgentLowerCommissionPanel"));
    assert.ok(!/functionName:\s*"lowerCommission"/.test(src));
  });
});
