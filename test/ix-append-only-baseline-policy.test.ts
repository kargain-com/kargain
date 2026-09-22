/**
 * Published-trunk baseline for commercial ix-manifest append-only.
 *
 * Pins resolveAppendOnlyBaseline + loadManifestAtBaseline: synthetic push/PR
 * payloads, named refusals, and in-memory append-only controls (no file plants).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ZERO_GITHUB_SHA,
  assertAppendOnlyVsPrior,
  loadManifestAtBaseline,
  resolveAppendOnlyBaseline,
  type AppendOnlyBaselinePorts,
  type AppendOnlyGitHubEvent,
  type LoadManifestAtBaselinePorts,
} from "@/lib/architecture/ix-append-only-baseline";
import type { IxManifest, IxManifestEntry } from "@/lib/svm/encode-instruction";

function entry(
  program: string,
  index: number,
  name: string,
): IxManifestEntry {
  return {
    program,
    enum: "TestIx",
    index,
    name,
    fields: [],
    sample: {},
    goldenHex: "00",
  };
}

function manifest(entries: IxManifestEntry[]): IxManifest {
  return { version: 1, entries };
}

function ports(partial: Partial<AppendOnlyBaselinePorts> & {
  eventName?: string;
  event?: AppendOnlyGitHubEvent | null;
}): AppendOnlyBaselinePorts {
  return {
    eventName: partial.eventName,
    event: partial.event ?? null,
    mergeBaseWithOriginMaster:
      partial.mergeBaseWithOriginMaster ?? (() => null),
    commitExists: partial.commitExists ?? (() => true),
  };
}

describe("ix append-only baseline resolver", () => {
  it("push with non-zero before → push_before", () => {
    const before = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const r = resolveAppendOnlyBaseline(
      ports({
        eventName: "push",
        event: { before },
        commitExists: (sha) => sha === before,
      }),
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.commit, before);
      assert.equal(r.source, "push_before");
    }
  });

  it("pull_request base.sha → pull_request_base", () => {
    const base = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const r = resolveAppendOnlyBaseline(
      ports({
        eventName: "pull_request",
        event: { pull_request: { base: { sha: base } } },
        commitExists: (sha) => sha === base,
      }),
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.commit, base);
      assert.equal(r.source, "pull_request_base");
    }
  });

  it("all-zero push before falls through to merge-base", () => {
    const merge = "cccccccccccccccccccccccccccccccccccccccc";
    const r = resolveAppendOnlyBaseline(
      ports({
        eventName: "push",
        event: { before: ZERO_GITHUB_SHA },
        mergeBaseWithOriginMaster: () => merge,
        commitExists: (sha) => sha === merge,
      }),
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.commit, merge);
      assert.equal(r.source, "merge_base_origin_master");
    }
  });

  it("local / workflow_call uses merge-base origin/master", () => {
    const merge = "dddddddddddddddddddddddddddddddddddddddd";
    const r = resolveAppendOnlyBaseline(
      ports({
        eventName: undefined,
        event: null,
        mergeBaseWithOriginMaster: () => merge,
        commitExists: (sha) => sha === merge,
      }),
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.source, "merge_base_origin_master");
      assert.equal(r.commit, merge);
    }
  });

  it("baseline_not_resolvable when no event tip and no merge-base", () => {
    const r = resolveAppendOnlyBaseline(
      ports({
        eventName: "workflow_call",
        event: {},
        mergeBaseWithOriginMaster: () => null,
      }),
    );
    assert.deepEqual(r, { ok: false, cause: "baseline_not_resolvable" });
  });

  it("baseline_commit_absent when push before is missing from clone", () => {
    const before = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const r = resolveAppendOnlyBaseline(
      ports({
        eventName: "push",
        event: { before },
        commitExists: () => false,
      }),
    );
    assert.deepEqual(r, { ok: false, cause: "baseline_commit_absent" });
  });

  it("loadManifestAtBaseline: baseline_manifest_absent", () => {
    const commit = "ffffffffffffffffffffffffffffffffffffffff";
    const loadPorts: LoadManifestAtBaselinePorts = {
      commitExists: () => true,
      showPath: () => null,
    };
    const r = loadManifestAtBaseline(commit, "path.json", loadPorts, JSON.parse);
    assert.deepEqual(r, { ok: false, cause: "baseline_manifest_absent" });
  });

  it("loadManifestAtBaseline: baseline_commit_absent", () => {
    const r = loadManifestAtBaseline(
      "1111111111111111111111111111111111111111",
      "path.json",
      { commitExists: () => false, showPath: () => "{}" },
      JSON.parse,
    );
    assert.deepEqual(r, { ok: false, cause: "baseline_commit_absent" });
  });
});

describe("ix append-only vs published-trunk controls (in-memory)", () => {
  const published = manifest([
    entry("kar-gateway", 0, "Initialize"),
    entry("kar-gateway", 1, "Send"),
  ]);

  it("published variant removed → red append_only_removed", () => {
    const working = manifest([entry("kar-gateway", 0, "Initialize")]);
    assert.throws(
      () => assertAppendOnlyVsPrior(published, working),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        return msg.includes("append_only_removed:kar-gateway:1:Send");
      },
    );
  });

  it("published variant renamed → red append_only_renamed", () => {
    const working = manifest([
      entry("kar-gateway", 0, "Initialize"),
      entry("kar-gateway", 1, "SendRenamed"),
    ]);
    assert.throws(
      () => assertAppendOnlyVsPrior(published, working),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        return msg.includes(
          "append_only_renamed:kar-gateway:1:was_Send_now_SendRenamed",
        );
      },
    );
  });

  it("variant only above baseline removed → green", () => {
    const baseline = published;
    const tipWithExtra = manifest([
      ...published.entries,
      entry("kar-gateway", 2, "OnlyLocal"),
    ]);
    // Working drops OnlyLocal (never published) — still has all baseline entries.
    const working = manifest([...published.entries]);
    assertAppendOnlyVsPrior(baseline, working);
    // Tip-with-extra vs baseline is an append — green.
    assertAppendOnlyVsPrior(baseline, tipWithExtra);
  });

  it("append after max → green", () => {
    const working = manifest([
      ...published.entries,
      entry("kar-gateway", 2, "NewIx"),
    ]);
    assertAppendOnlyVsPrior(published, working);
  });
});
