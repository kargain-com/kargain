# 0008 — Issue, branch, PR, CI, review

## Context

Untracked decisions and direct pushes to `master` reopen settled questions and ship code that never faced the gates. Public docs in mixed languages split the contributor surface.

## Decision

- Work flow: **one issue → one branch → one PR → CI → review**. Nobody pushes to `master`; only the maintainer merges, deploys, and runs on-chain operations ([`AGENTS.md`](../../AGENTS.md) — How work flows).
- Gates on every PR against `master` run from [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) (`pull_request` and `push` to `master`). Local gate output is attached only when CI does not yet run that gate.
- Pause-class changes open an ADR PR first ([`docs/adr/README.md`](./README.md); [`AGENTS.md`](../../AGENTS.md) pause classes).
- Public artefacts are **English** (UI: [`docs/design-spec.md`](../design-spec.md) Locales / `lang="en"`; this docs tree).

## One rejected alternative and why

Allow direct commits to `master` for “docs and hotfixes.” Rejected: it bypasses the same gates and review that protect product invariants, and splits the merge path.

## Consequences

Contributors open PRs; CI is the counted gate result. ADR numbers are reserved in order; seeds 0001–0008 record decisions already in force. Product copy and public docs stay English-only.

## Status

Accepted
