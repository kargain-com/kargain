# Evidence

Claims are ranked by what backs them. State the tier when the claim matters. A report, a document statement, and recall are **input**, not fact.

## Tiers

| Tier | Source | Weight |
|------|--------|--------|
| 1 | A named regression test asserting the behaviour | Strongest |
| 2 | Source read with file and line | Default working tier |
| 3 | Deploy constant traced through deploy → init → record | Sufficient when no getter exists; say so |
| 4 | On-chain read-back with a getter | Strong only when a getter exists |
| 5 | A statement in a document | Not evidence |
| 6 | Recall | Not evidence; never cite it |

A tier-3 conclusion must not be presented as a chain read. Derive contract facts from contracts and named tests; when a document disagrees, correct it in the same change. A normative document is authoritative on **intent**, not on factual parameter values — before invoking authority, ask whether the disputed statement is intent or description.

## Measuring what is live

- A change is done when it is merged with green CI; an uncommitted tree or an unpushed branch is not a result — only the accepted commit counts.
- A production claim needs `git show master:<path>` and a deploy record under [`docs/ops/deploys/`](../ops/deploys/), not a file on a working branch.
- A claim about what the user sees requires opening the component that renders it — output is not reading.
- Every count in an issue is a floor with its method; a larger measured set wins.
- The committed registry ([`lib/web3/commercial-active.ts`](../../lib/web3/commercial-active.ts)) is the only runtime source of addresses and program ids; deploy evidence files are deploy-machine asserts outside the runtime graph.
- A deployed binary is not its source: "program emits X" is proven by build identity (hash of the `.so` against the current source build).
- A key is sound only if it covers every input of what it identifies: environment, files read at run time, the build context, transitive imports, dependency versions. A framework's own hash is not an identity of the code that wrote the data ([ADR 0016](../adr/0016-one-writer-schema-per-indexing-identity.md#context) Context §3).

Tip claims are measured after fetch against the published tip, never incremented from memory. Present-tense law must not be taken from chat or unpublished notes; measure before stating what is live. Historical facts go in past tense, marked superseded or denylisted — never rewritten as present law.

## Search discipline

Wrong operator or scope produces confident false statements.

| Question | Rule |
|----------|------|
| Did this value ever differ? | Use `git log -G` or `-p`, not `-S` alone (`-S` counts symbol presence, not value edits) |
| Does X exist / how many places? | Absence is what grep proves worst; widen scope and change operator before believing a count |
| Pattern variants of one misuse? | Do not characterise a defect by pattern; find the API, then read each consumer |
| Does this match exist? | Do not pipe a verification search through `head` |

An enumerated search list is a floor, never a ceiling. Before writing "N places do X", count with this method or make establishing N part of the task.

## Empty results and readiness

- An empty result has three explanations — nothing to observe, nothing to observe with, nobody to call. Exclude the last two before concluding the first.
- Visited is not complete: an empty sample does not confirm catch-up, clear a backfill flag, or move a watermark.
- Silence is not health: progress facts live on the readiness surface (`/ready`, `/status`, `/read-path-ready`), not in logs.

## Property, placement, and models

- Name a predicate for the **property**, not for the use — a use-shaped name invites a sibling for every caller.
- With no users, legacy is weight, not a requirement; ask whether anything needs migrating before designing a migration.
- Do not reopen closed identity models, or a finished browse-path or performance initiative, without a demonstrated hole.
- When a guard is added, ask where else the same input arrives.
- Deployment cost is a planning question, not an architectural one — fix the source; schedule the deploy separately.
- Quote the invariant into the brief; do not cite it from memory of its purpose. Where a document claims monotonicity or impossibility, check the arithmetic as written.
- Presence is not placement: check phase and subject, not that a call appears somewhere. "Not shown" is not automatically "withheld" — check whether the model owes the information.
- A shortfall from an under-scoped brief is rework now, not backlog.
- Reachability is decided by the type, not by field optionality (`string` includes `""`); express the invariant as a brand before removing a guard.
- A test against a home-made model tests the model: SQL is executed by the engine, not parsed with regular expressions.
- Comparing two outputs of the same generator is not parity.
- A class that does not name what exactly it covers explains everything and checks nothing.
- Two encodings of one fact is the recurring defect class — also as "invented value instead of a named absence" and "a guard that cannot fail".
