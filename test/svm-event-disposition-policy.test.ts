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

  it("census sync: every manifest row resolves as census (unless named divergence)", () => {
    const resolved = resolveEventDispositions({
      abiEvents,
      manifestEntries,
      namedDivergences,
      dispositions,
    });
    const divergenceKeys = new Set(
      namedDivergences.map((d) => eventKey(d.contract, d.event)),
    );
    for (const entry of manifestEntries) {
      const key = eventKey(entry.contract, entry.event);
      const row = resolved.get(key);
      assert.ok(row, `missing resolution for census row ${key}`);
      if (divergenceKeys.has(key)) {
        assert.equal(row.kind, "named_divergence");
      } else {
        assert.equal(row.kind, "census");
      }
    }
  });

  it("named divergence sync: D-38…D-42 resolve with matching specId", () => {
    const resolved = resolveEventDispositions({
      abiEvents,
      manifestEntries,
      namedDivergences,
      dispositions,
    });
    for (const div of namedDivergences) {
      const key = eventKey(div.contract, div.event);
      const row = resolved.get(key);
      assert.equal(row?.kind, "named_divergence");
      if (row?.kind === "named_divergence") {
        assert.equal(row.specId, div.specId);
      }
    }
    assert.deepEqual(
      namedDivergences.map((d) => d.specId).sort(),
      ["D-38", "D-39", "D-40", "D-41", "D-42"],
    );
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
  }
}
