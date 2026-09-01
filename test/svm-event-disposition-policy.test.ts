/**
 * S7-event-disposition — every commercial ABI event has exactly one recorded disposition.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  eventKey,
  listCommercialAbiEvents,
  resolveEventDispositions,
  validateEventDispositionCoverage,
  type EventDispositionsFile,
} from "../lib/svm/commercial-abi-events.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CRATE = path.join(ROOT, "svm/crates/kargain-events");

function loadDispositions(): EventDispositionsFile {
  return JSON.parse(
    fs.readFileSync(path.join(CRATE, "event-dispositions.json"), "utf8"),
  ) as EventDispositionsFile;
}

function loadManifestEntries(): Array<{ contract: string; event: string }> {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(CRATE, "events.manifest.json"), "utf8"),
  ) as { entries: Array<{ contract: string; event: string }> };
  return manifest.entries;
}

function loadNamedDivergences(): Array<{
  contract: string;
  event: string;
  specId: string;
}> {
  return JSON.parse(
    fs.readFileSync(path.join(CRATE, "named-divergences.json"), "utf8"),
  ) as Array<{ contract: string; event: string; specId: string }>;
}

/** Pinned census of manual out_of_scope rows — ABI drift must update deliberately. */
const PINNED_OUT_OF_SCOPE_KEYS = [
  "AscendingConsignment:Initialized",
  "AscendingConsignment:OwnershipTransferred",
  "AscendingConsignment:Upgraded",
  "FixedPriceConsignment:Initialized",
  "FixedPriceConsignment:OwnershipTransferred",
  "FixedPriceConsignment:Upgraded",
  "KarPassport:Approval",
  "KarPassport:ApprovalForAll",
  "KarPassport:BatchMetadataUpdate",
  "KarPassport:BridgeGatewaySet",
  "KarPassport:EncumbranceSourceAdded",
  "KarPassport:EncumbranceSourceRemoved",
  "KarPassport:EthRescued",
  "KarPassport:MetadataUpdate",
  "KarPassport:OwnershipTransferred",
  "KarPassportBridgeGateway:EnforcedOptionSet",
  "KarPassportBridgeGateway:MsgInspectorSet",
  "KarPassportBridgeGateway:OwnershipTransferred",
  "KarPassportBridgeGateway:PeerSet",
  "KarPassportBridgeGateway:PreCrimeSet",
  "KarPassportBridgeGateway:RecoveredLockedHome",
  "KarProPass:Approval",
  "KarProPass:ApprovalForAll",
  "KarProPass:OwnershipTransferred",
  "KarProPass:StakingSet",
  "KarProPass:Transfer",
  "KarProStaking:MinStakeNativeUpdated",
  "KarProStaking:OwnershipTransferred",
  "KarProStaking:StakeClaimed",
  "KarProStaking:UnbondStarted",
] as const;

const PINNED_REASON_CLASS_COUNTS: Record<string, number> = {
  upgradeability: 4,
  ownership_transfer: 6,
  erc721_standard: 7,
  oapp_config: 4,
  chain_read: 3,
  governance_admin: 4,
  governed_recovery_no_guid: 1,
  superseded_by_census_event: 1,
};

describe("svm event disposition policy", () => {
  const abiEvents = listCommercialAbiEvents();
  const manifestEntries = loadManifestEntries();
  const namedDivergences = loadNamedDivergences();
  const dispositions = loadDispositions();

  it("forward: every ABI event has a disposition", () => {
    const problems = validateEventDispositionCoverage({
      abiEvents,
      manifestEntries,
      namedDivergences,
      dispositions,
    });
    assert.deepEqual(problems, [], problems.map(formatProblem).join("\n"));
    assert.equal(abiEvents.length, 110);
  });

  it("reverse: no orphan out_of_scope row references a missing ABI event", () => {
    const abiKeys = new Set(abiEvents.map((e) => eventKey(e.contract, e.event)));
    const orphans = dispositions.outOfScope.filter(
      (row) => !abiKeys.has(eventKey(row.contract, row.event)),
    );
    assert.deepEqual(orphans, []);
  });

  it("census sync: every manifest row resolves as census", () => {
    const resolved = resolveEventDispositions({
      abiEvents,
      manifestEntries,
      namedDivergences,
      dispositions,
    });
    for (const entry of manifestEntries) {
      const key = eventKey(entry.contract, entry.event);
      const row = resolved.get(key);
      assert.ok(row, `missing resolution for census row ${key}`);
      assert.equal(row.kind, "census");
    }
  });

  it("named divergence sync: D-40–D-42 annotate census rows; D-38/D-39 are divergence-only", () => {
    const resolved = resolveEventDispositions({
      abiEvents,
      manifestEntries,
      namedDivergences,
      dispositions,
    });
    const censusKeys = new Set(
      manifestEntries.map((e) => eventKey(e.contract, e.event)),
    );
    for (const div of namedDivergences) {
      const key = eventKey(div.contract, div.event);
      const row = resolved.get(key);
      assert.ok(row);
      if (censusKeys.has(key)) {
        assert.equal(row.kind, "census");
        if (row.kind === "census") {
          assert.equal(row.divergenceSpecId, div.specId);
        }
      } else {
        assert.equal(row.kind, "named_divergence");
        if (row.kind === "named_divergence") {
          assert.equal(row.specId, div.specId);
        }
      }
    }
    assert.deepEqual(
      namedDivergences.map((d) => d.specId).sort(),
      ["D-38", "D-39", "D-40", "D-41", "D-42"],
    );
  });

  it("partition: 78 census + 2 divergence-only + 30 out_of_scope = 110 ABI events", () => {
    const resolved = resolveEventDispositions({
      abiEvents,
      manifestEntries,
      namedDivergences,
      dispositions,
    });
    const censusKeys = new Set(
      manifestEntries.map((e) => eventKey(e.contract, e.event)),
    );
    const divergenceOnly = namedDivergences.filter(
      (d) => !censusKeys.has(eventKey(d.contract, d.event)),
    );
    let census = 0;
    let namedDivergence = 0;
    let outOfScope = 0;
    for (const row of resolved.values()) {
      if (row.kind === "census") census++;
      else if (row.kind === "named_divergence") namedDivergence++;
      else outOfScope++;
    }
    assert.equal(census, 78);
    assert.equal(namedDivergence, 2);
    assert.equal(outOfScope, 30);
    assert.equal(divergenceOnly.length, 2);
    assert.deepEqual(
      divergenceOnly.map((d) => d.specId).sort(),
      ["D-38", "D-39"],
    );
    assert.equal(census + namedDivergence + outOfScope, 110);
  });

  it("pin: exact 30 outOfScope keys and reason-class member counts", () => {
    const keys = dispositions.outOfScope
      .map((r) => eventKey(r.contract, r.event))
      .sort();
    assert.deepEqual(keys, [...PINNED_OUT_OF_SCOPE_KEYS].sort());
    const counts = new Map<string, number>();
    for (const row of dispositions.outOfScope) {
      counts.set(row.reasonClass, (counts.get(row.reasonClass) ?? 0) + 1);
    }
    assert.deepEqual(Object.fromEntries(counts), PINNED_REASON_CLASS_COUNTS);
  });

  it("superseded_by_census_event: requires supersededBy pointing at a census row", () => {
    const rows = dispositions.outOfScope.filter(
      (r) => r.reasonClass === "superseded_by_census_event",
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]?.supersededBy, {
      contract: "KarProStaking",
      event: "VerifierLeft",
    });
    const censusKeys = new Set(
      manifestEntries.map((e) => eventKey(e.contract, e.event)),
    );
    for (const row of rows) {
      assert.ok(row.supersededBy);
      assert.ok(
        censusKeys.has(
          eventKey(row.supersededBy.contract, row.supersededBy.event),
        ),
      );
    }
  });

  it("reason class pin: every outOfScope row uses a declared reasonClass", () => {
    const allowed = new Set(Object.keys(dispositions.reasonClasses));
    for (const row of dispositions.outOfScope) {
      assert.ok(
        allowed.has(row.reasonClass),
        `${row.contract}:${row.event} reasonClass ${row.reasonClass}`,
      );
    }
    assert.equal(dispositions.outOfScope.length, 30);
  });

  it("constructed violation: ABI event without disposition fails coverage", () => {
    const problems = validateEventDispositionCoverage({
      abiEvents: [
        ...abiEvents,
        { contract: "KarPassport", event: "SyntheticUndispositioned" },
      ],
      manifestEntries,
      namedDivergences,
      dispositions,
    });
    assert.ok(
      problems.some((p) => p.type === "abi_event_missing_disposition"),
    );
  });

  it("constructed violation: orphan out_of_scope row fails coverage", () => {
    const problems = validateEventDispositionCoverage({
      abiEvents,
      manifestEntries,
      namedDivergences,
      dispositions: {
        ...dispositions,
        outOfScope: [
          ...dispositions.outOfScope,
          {
            contract: "KarPassport",
            event: "NoSuchAbiEvent",
            reasonClass: "erc721_standard",
            rationale: "fixture",
          },
        ],
      },
    });
    assert.ok(problems.some((p) => p.type === "orphan_out_of_scope"));
  });

  it("constructed violation: out_of_scope overlaps census row", () => {
    const problems = validateEventDispositionCoverage({
      abiEvents,
      manifestEntries,
      namedDivergences,
      dispositions: {
        ...dispositions,
        outOfScope: [
          ...dispositions.outOfScope,
          {
            contract: "KarProStaking",
            event: "VerifierJoined",
            reasonClass: "erc721_standard",
            rationale: "shadow census row",
          },
        ],
      },
    });
    assert.ok(problems.some((p) => p.type === "out_of_scope_overlaps_census"));
  });

  it("constructed violation: out_of_scope overlaps divergence-only row", () => {
    const problems = validateEventDispositionCoverage({
      abiEvents,
      manifestEntries,
      namedDivergences,
      dispositions: {
        ...dispositions,
        outOfScope: [
          ...dispositions.outOfScope,
          {
            contract: "KarPassport",
            event: "VerificationLapsed",
            reasonClass: "erc721_standard",
            rationale: "shadow D-38",
          },
        ],
      },
    });
    assert.ok(
      problems.some((p) => p.type === "out_of_scope_overlaps_divergence_only"),
    );
  });

  it("constructed violation: invalid reasonClass fails coverage", () => {
    const problems = validateEventDispositionCoverage({
      abiEvents,
      manifestEntries,
      namedDivergences,
      dispositions: {
        ...dispositions,
        outOfScope: dispositions.outOfScope.map((row, i) =>
          i === 0 ? { ...row, reasonClass: "not_a_real_class" } : row,
        ),
      },
    });
    assert.ok(problems.some((p) => p.type === "invalid_reason_class"));
  });

  it("constructed violation: superseded_by_census_event without supersededBy", () => {
    const problems = validateEventDispositionCoverage({
      abiEvents,
      manifestEntries,
      namedDivergences,
      dispositions: {
        ...dispositions,
        outOfScope: dispositions.outOfScope.map((row) =>
          row.event === "UnbondStarted"
            ? { ...row, supersededBy: undefined }
            : row,
        ),
      },
    });
    assert.ok(
      problems.some(
        (p) => p.type === "superseded_by_census_event_missing_pointer",
      ),
    );
  });

  it("constructed violation: supersededBy with wrong reasonClass", () => {
    const problems = validateEventDispositionCoverage({
      abiEvents,
      manifestEntries,
      namedDivergences,
      dispositions: {
        ...dispositions,
        outOfScope: dispositions.outOfScope.map((row) =>
          row.event === "UnbondStarted"
            ? { ...row, reasonClass: "chain_read" }
            : row,
        ),
      },
    });
    assert.ok(
      problems.some(
        (p) => p.type === "superseded_by_census_event_missing_target",
      ),
    );
  });

  it("constructed violation: supersededBy target not in census", () => {
    const problems = validateEventDispositionCoverage({
      abiEvents,
      manifestEntries,
      namedDivergences,
      dispositions: {
        ...dispositions,
        outOfScope: dispositions.outOfScope.map((row) =>
          row.event === "UnbondStarted"
            ? {
                ...row,
                supersededBy: {
                  contract: "KarProStaking",
                  event: "StakeClaimed",
                },
              }
            : row,
        ),
      },
    });
    assert.ok(problems.some((p) => p.type === "superseded_by_not_in_census"));
  });
});

function formatProblem(
  p: ReturnType<typeof validateEventDispositionCoverage>[number],
): string {
  switch (p.type) {
    case "abi_event_missing_disposition":
      return `missing: ${p.contract}:${p.event}`;
    case "orphan_out_of_scope":
      return `orphan: ${p.contract}:${p.event}`;
    case "invalid_reason_class":
      return `bad class ${p.reasonClass} on ${p.contract}:${p.event}`;
    case "superseded_by_not_in_census":
      return `bad supersededBy on ${p.contract}:${p.event}`;
    case "superseded_by_census_event_missing_target":
      return `supersededBy without class on ${p.contract}:${p.event}`;
    case "superseded_by_census_event_missing_pointer":
      return `missing supersededBy on ${p.contract}:${p.event}`;
    case "out_of_scope_overlaps_census":
      return `shadow census: ${p.contract}:${p.event}`;
    case "out_of_scope_overlaps_divergence_only":
      return `shadow divergence: ${p.contract}:${p.event}`;
  }
}
