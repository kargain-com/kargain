/**
 * Sole owner: resolve the published-trunk baseline commit for commercial
 * instruction-manifest append-only checks.
 *
 * Authority is the tip this change is measured against — not local HEAD:
 * - CI push → event.before (non-zero)
 * - CI pull_request → event.pull_request.base.sha
 * - else → git merge-base HEAD origin/master (local + workflow_call)
 *
 * Missing baseline / commit / manifest refuse by name — never skip.
 */

import assert from "node:assert/strict";

import type { IxManifest, IxManifestEntry } from "@/lib/svm/encode-instruction";

export const ZERO_GITHUB_SHA = "0".repeat(40);

export type AppendOnlyBaselineCause =
  | "baseline_not_resolvable"
  | "baseline_commit_absent"
  | "baseline_manifest_absent";

export type AppendOnlyBaselineSource =
  | "push_before"
  | "pull_request_base"
  | "merge_base_origin_master";

export type AppendOnlyBaselineOk = {
  ok: true;
  commit: string;
  source: AppendOnlyBaselineSource;
};

export type AppendOnlyBaselineErr = {
  ok: false;
  cause: AppendOnlyBaselineCause;
};

export type AppendOnlyBaselineResult = AppendOnlyBaselineOk | AppendOnlyBaselineErr;

/** Minimal GitHub Actions event shape used by the resolver. */
export type AppendOnlyGitHubEvent = {
  before?: string;
  pull_request?: { base?: { sha?: string } };
};

export type AppendOnlyBaselinePorts = {
  eventName: string | undefined;
  event: AppendOnlyGitHubEvent | null;
  /** git merge-base HEAD origin/master → sha or null when unresolvable. */
  mergeBaseWithOriginMaster: () => string | null;
  /** True when `git cat-file -e <sha>^{commit}` would succeed. */
  commitExists: (sha: string) => boolean;
};

function isNonZeroSha(sha: string | undefined): sha is string {
  if (sha == null || sha.length === 0) return false;
  return sha !== ZERO_GITHUB_SHA && !/^0+$/.test(sha);
}

/**
 * Resolve the baseline commit SHA. Does not load the manifest — call
 * `loadManifestAtBaseline` next.
 */
export function resolveAppendOnlyBaseline(
  ports: AppendOnlyBaselinePorts,
): AppendOnlyBaselineResult {
  const event = ports.event;

  if (ports.eventName === "push" && event != null && isNonZeroSha(event.before)) {
    const commit = event.before;
    if (!ports.commitExists(commit)) {
      return { ok: false, cause: "baseline_commit_absent" };
    }
    return { ok: true, commit, source: "push_before" };
  }

  if (ports.eventName === "pull_request") {
    const base = event?.pull_request?.base?.sha;
    if (isNonZeroSha(base)) {
      if (!ports.commitExists(base)) {
        return { ok: false, cause: "baseline_commit_absent" };
      }
      return { ok: true, commit: base, source: "pull_request_base" };
    }
  }

  const mergeBase = ports.mergeBaseWithOriginMaster();
  if (mergeBase != null && mergeBase.length > 0) {
    if (!ports.commitExists(mergeBase)) {
      return { ok: false, cause: "baseline_commit_absent" };
    }
    return {
      ok: true,
      commit: mergeBase,
      source: "merge_base_origin_master",
    };
  }

  return { ok: false, cause: "baseline_not_resolvable" };
}

export type LoadManifestAtBaselinePorts = {
  commitExists: (sha: string) => boolean;
  /** `git show <commit>:<relPath>` text, or null if path absent / command fails. */
  showPath: (commit: string, relPath: string) => string | null;
};

export type LoadManifestAtBaselineResult<T> =
  | { ok: true; manifest: T }
  | { ok: false; cause: AppendOnlyBaselineCause };

/**
 * Load and parse the manifest JSON at a resolved baseline commit.
 */
export function loadManifestAtBaseline<T>(
  commit: string,
  relPath: string,
  ports: LoadManifestAtBaselinePorts,
  parse: (text: string) => T,
): LoadManifestAtBaselineResult<T> {
  if (!ports.commitExists(commit)) {
    return { ok: false, cause: "baseline_commit_absent" };
  }
  const text = ports.showPath(commit, relPath);
  if (text == null) {
    return { ok: false, cause: "baseline_manifest_absent" };
  }
  return { ok: true, manifest: parse(text) };
}

function entryKey(e: Pick<IxManifestEntry, "program" | "index">): string {
  return `${e.program}:${e.index}`;
}

/**
 * Append-only vs a prior manifest: existing (program,index) names stable;
 * new indices contiguous after prior max.
 */
export function assertAppendOnlyVsPrior(
  prior: IxManifest,
  working: IxManifest,
): void {
  const workingByKey = new Map(
    working.entries.map((e) => [entryKey(e), e] as const),
  );
  const priorMax = new Map<string, number>();
  for (const e of prior.entries) {
    const prev = priorMax.get(e.program) ?? -1;
    if (e.index > prev) priorMax.set(e.program, e.index);
    const cur = workingByKey.get(entryKey(e));
    assert.ok(
      cur,
      `append_only_removed:${e.program}:${e.index}:${e.name}`,
    );
    assert.equal(
      cur!.name,
      e.name,
      `append_only_renamed:${e.program}:${e.index}:was_${e.name}_now_${cur!.name}`,
    );
  }
  for (const e of working.entries) {
    const max = priorMax.get(e.program);
    if (max == null) continue;
    const priorHad = prior.entries.some(
      (p) => p.program === e.program && p.index === e.index,
    );
    if (!priorHad) {
      assert.ok(
        e.index === max + 1 || e.index > max,
        `append_only_gap_insert:${e.program}:${e.index}:prior_max_${max}`,
      );
    }
  }
  for (const [program, max] of priorMax) {
    const newIndices = working.entries
      .filter((e) => e.program === program && e.index > max)
      .map((e) => e.index)
      .sort((a, b) => a - b);
    for (let i = 0; i < newIndices.length; i++) {
      assert.equal(
        newIndices[i],
        max + 1 + i,
        `append_only_non_contiguous:${program}:want_${max + 1 + i}_got_${newIndices[i]}`,
      );
    }
  }
}
