# Enforcement

Rules become executable policies. Prefer an import ban and a named owner over a descriptive regex that authors can evade.

## Idiom

A raw API is banned outside exactly one owning module; a test reachable from a targeted `test:*` gate enforces the ban. The executable registry is [`lib/architecture/chokepoints.ts`](../../lib/architecture/chokepoints.ts). Area owners are summarised in [`AGENTS.md`](../../AGENTS.md#choke-points); do not duplicate that table here.

**Ban the import, not the misuse pattern.** Detecting one syntax form failed repeatedly; banning the raw API outside its owner is unambiguous.

**No allowlists.** If a consumer appears to need an exemption, the primitive's surface is wrong — fix the primitive.

**When copy states a consequence, the consequence belongs in data.** A screen that re-authors terminal meaning can reintroduce a copy defect tomorrow; that is an architecture defect.

`eslint-disable` is forbidden ([`AGENTS.md`](../../AGENTS.md#forbidden)): disabling a lint to paper over a missing owner recreates the dual-source class the choke-point exists to prevent.

## How to add a choke-point

1. Put the rule in one owning module (extend an existing owner when the concern already has one).
2. Register it in [`lib/architecture/chokepoints.ts`](../../lib/architecture/chokepoints.ts) with a guarding test that exists.
3. Enforce with a policy suite under `test/` that scans product roots via [`test/policy-scan-helpers.ts`](../../test/policy-scan-helpers.ts) (or an equivalent structural check).
4. Ensure the suite is reachable from a targeted `test:*` gate (see [gates.md](./gates.md)). The meta-test [`test/architectural-enforcement-meta.test.ts`](../../test/architectural-enforcement-meta.test.ts) fails if a choke-point lacks a reachable guard, or if a new `*policy*` / `*invariant*` / `*coverage*` / `*contract*` suite is unreachable.

Delete dual paths in the same change. Do not open a second door beside a choke-point.

## Policy-test fitness

A green suite that pins the wrong thing certifies silence.

1. **Pin the rule, not one syntax.** Prefer structural bans (owner module, typed parse, import ban) over regex for a single surface form.
2. **Check both directions** — index↔predicate, catalog↔handler, registry↔guard. A one-sided test lets one class through.
3. **Stay red while the product is broken.** Deferred product state must not be asserted as the desired end-state; pin debt as an explicit failing or ratchet obligation, or leave it unpinned until the surface works.
4. **Reachable from a `test:*` gate.** Update the choke-point registry when adding a new owner.

- A pin that fixes wrong behaviour is inverted in place, never deleted or renamed — so the ratchet remains named.

A new classification axis must not reuse an existing canonical axis name-shape. Parallel labels that look like a continuation of another axis will be read as one.

## Production vs test environment

- Never bend production to fit a test environment; fix types or the environment.
- Debt is not carried: debt created by a change is closed in the same change; inherited debt gets its own unit before the next phase.
- A state machine that changes production (deploy, migration, bridge, settlement) is proven by an exhaustive crash-injection test over its real owners, with planted defects turning it red, not by reasoning about the success path.

## Recurring defect classes

- A second independent copy of the same defect means a missing owner, not two call sites to patch ([`AGENTS.md`](../../AGENTS.md#engineering-rules)).
- Two encodings of one fact — also "invented value instead of a named absence" and "a guard that cannot fail" — is the recurring class; ownership is the repair.
- A test against a home-made model tests the model (execute SQL with the engine; do not parse it with regex).
- Comparing two outputs of the same generator is not parity.
