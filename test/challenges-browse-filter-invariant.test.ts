/**
 * Challenges browse: chrome chips → one query owner → catalog/handler;
 * unresolved ≡ isChallengeUnresolved; no action/client dual filters.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CHALLENGE_BROWSE_FILTER_OPTIONS,
  challengeBrowseFilterToQuery,
  challengeUnresolvedStatuses,
  parseChallengeStatusFilter,
} from "../lib/challenge/browse-filters.ts";
import { isChallengeUnresolved } from "../lib/commerce/challenge-display.ts";
import type { ChallengeStatus } from "../lib/commerce/ponder-consignment.ts";
import { PONDER_IMPLEMENTED_ROUTES } from "../lib/web3/ponder-endpoints.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function challengesListQueryKeys(): Set<string> {
  const entry = PONDER_IMPLEMENTED_ROUTES.find((e) => e.id === "challenges.list");
  assert.ok(entry, "challenges.list catalog entry missing");
  return new Set(entry.query);
}

describe("challenges browse filter invariant", () => {
  it("unresolved statuses ↔ isChallengeUnresolved (both directions)", () => {
    const all: ChallengeStatus[] = [
      "open",
      "withdrawn",
      "judged",
      "concluded",
    ];
    const fromOwner = challengeUnresolvedStatuses();
    for (const s of all) {
      assert.equal(
        fromOwner.includes(s),
        isChallengeUnresolved(s),
        `status ${s} must agree between list and predicate`,
      );
    }
    assert.deepEqual(fromOwner.slice().sort(), ["judged", "open"]);
  });

  it("chip → query maps through owner (mine uses challenger; unresolved uses status CSV)", () => {
    const unresolved = challengeBrowseFilterToQuery("unresolved");
    assert.equal(unresolved.ok, true);
    if (unresolved.ok) {
      assert.equal(unresolved.query.status, "open,judged");
      assert.equal(unresolved.query.instance, undefined);
      assert.equal(unresolved.query.challenger, undefined);
    }

    const passport = challengeBrowseFilterToQuery("passport");
    assert.equal(passport.ok, true);
    if (passport.ok) {
      assert.equal(passport.query.instance, "passport");
    }

    const ascending = challengeBrowseFilterToQuery("ascending");
    assert.equal(ascending.ok, true);
    if (ascending.ok) {
      assert.equal(ascending.query.instance, "ascending");
    }

    const mineMissing = challengeBrowseFilterToQuery("mine", null);
    assert.equal(mineMissing.ok, false);

    const mine = challengeBrowseFilterToQuery(
      "mine",
      "0xAbcDef0000000000000000000000000000000001",
    );
    assert.equal(mine.ok, true);
    if (mine.ok) {
      assert.equal(
        mine.query.challenger,
        "0xAbcDef0000000000000000000000000000000001",
      );
      assert.equal(mine.query.instance, undefined);
      assert.equal(mine.query.status, undefined);
    }

    assert.deepEqual(
      CHALLENGE_BROWSE_FILTER_OPTIONS.map((o) => o.id),
      ["unresolved", "passport", "ascending", "mine"],
    );
  });

  it("status CSV parse feeds SQL IN; unknown token fails closed", () => {
    assert.deepEqual(parseChallengeStatusFilter("open"), ["open"]);
    assert.deepEqual(parseChallengeStatusFilter("open,judged"), [
      "open",
      "judged",
    ]);
    assert.equal(parseChallengeStatusFilter("open,bogus"), null);
    assert.equal(parseChallengeStatusFilter(undefined), undefined);
  });

  it("browse query keys from owner are in catalog and /challenges handler", () => {
    const catalog = challengesListQueryKeys();
    const handler = read("src/api/commerce-routes.ts");
    const start = handler.indexOf('app.get("/challenges"');
    assert.ok(start >= 0);
    const block = handler.slice(start, start + 2500);

    for (const key of ["instance", "status", "challenger"] as const) {
      assert.equal(catalog.has(key), true, `${key} missing from catalog`);
      assert.match(block, new RegExp(`query\\(["']${key}["']\\)`));
    }
    assert.match(block, /parseChallengeStatusFilter/);
    assert.match(block, /inArray\(challenge\.status/);
  });

  it("action and chrome consume owner — no dual unresolved / mine filters", () => {
    const action = read("app/actions/commerce-challenges.ts");
    assert.doesNotMatch(action, /unresolved/);
    assert.doesNotMatch(action, /status === ["']open["']\s*\|\|/);
    assert.doesNotMatch(action, /rows\.filter/);

    const client = read("components/challenges/challenges-client.tsx");
    assert.match(client, /challengeBrowseFilterToQuery/);
    assert.match(client, /CHALLENGE_BROWSE_FILTER_OPTIONS/);
    assert.doesNotMatch(client, /function filterChallenges/);
    assert.doesNotMatch(client, /isChallengeUnresolved/);
    assert.doesNotMatch(client, /rows\.filter/);
  });
});
