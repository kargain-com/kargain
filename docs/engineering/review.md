# Review

Never accept on the report alone. Verify against the committed tree on the PR head.

## Checklist (every PR)

- [ ] Commit under review; CI green on that head ([`AGENTS.md` § Gates](../../AGENTS.md#gates) for *Where* / *When*).
- [ ] Tools the issue named, with their output attached (local-only gates: paste command + tail — see [`.github/PULL_REQUEST_TEMPLATE.md`](../../.github/PULL_REQUEST_TEMPLATE.md)).
- [ ] Negative controls red before green ([`AGENTS.md`](../../AGENTS.md#engineering-rules)).
- [ ] Claims verified in the tree, not in the description ([evidence.md](./evidence.md)).
- [ ] Invariants from [`AGENTS.md`](../../AGENTS.md) hold for the change class.
- [ ] Docs updated per the [documentation map](../../AGENTS.md#documentation-map-single-sources).
- [ ] Reindex / on-chain / VPS impact stated (template Impact checkboxes).

## Accepting a report — order of suspicion

1. **A test was modified to make a gate green.** Most suspicious. Check whether the code under test was touched and whether committed config already contradicted the old assertion. Distinguish a deliberate ratchet (forces a decision when a surface grows) from a stale expectation.
2. **Anything unusual in the process narrative** — stray checkout, restored file. Verify the diff is complete.
3. **Junk in the diff** — files unrelated to the task (for example auto-generated `next-env.d.ts` committed with a feature).
4. **The stated requirement that is easiest to fake.** Check intent, not just letter.

Demand the gate result even when the report reads as complete — an omitted gate looks identical to success. A reported red test is a debt: establish the full set of failures and close every one with a named cause before the next task.

## Stop rules and commits

- A stop rule in a brief is a stop; one review → one commit; two units accepted separately are never one commit.
- A requirement that contradicts the canonical plan is a defect in the requirement; refusing with a reference to the plan is correct.
- Keys are never printed or committed; temporary CLI keypairs are deleted after use ([`AGENTS.md`](../../AGENTS.md#how-work-flows)).
- When a decision is superseded, every open issue and tracked document that relies on it is corrected in the same change.
- A decision names the future steps it must not block and shows that each is an extension, not a rewrite.

A behaviour-preserving refactor and a behaviour-changing feature ship as separate commits, refactor first — bisect, acceptance, and rollback require the split.

A comment-only correction to a deployed contract is made in that contract's next implementation change; the issue that tracks it names that change.

## Documentation conflicts and references

Stale text versus shipped behaviour — not "who decided what". Re-read the code; correct the doc in the same change. Never rewrite history: annotate superseded claims; keep historical facts in past tense.

- A bare `§N` means a section of **that** document.
- Cross-document references name the document (`SPEC §7.6`, design-spec §10).
- Describe properties, methods, invariants and required evidence in briefs; do not enumerate files as scope. An issue list is a floor ([`AGENTS.md`](../../AGENTS.md#engineering-rules)).
- Never link paths that are not tracked ([`AGENTS.md`](../../AGENTS.md#forbidden)).

Failing closed and reporting the cause are separate obligations — when a vocabulary of causes exists, every gate on those conditions inherits it.
