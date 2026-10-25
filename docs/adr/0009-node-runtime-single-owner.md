# 0009 — One pinned Node.js runtime

## Context

Measured on `6633840` with:

```bash
git grep -nE 'node-version|FROM node|"engines"|@types/node|Node\.js 2' 6633840c -- ':!pnpm-lock.yaml'
```

Absences: `git ls-tree -r --name-only 6633840c | rg '^\.nvmrc$|^\.node-version$'` (empty); `git grep -nE '"engines"' 6633840c -- package.json` (empty). Corepack: `git grep -nE 'corepack|pnpm@10\.6\.5' 6633840c -- ':!pnpm-lock.yaml'`.

- `Dockerfile.ponder:1` and `Dockerfile.svm-ingest:1`: `FROM node:20-alpine`. Node.js 20 reached end of life on 2026-04-30 ([release schedule](https://github.com/nodejs/Release/blob/main/schedule.json), linked from [nodejs.org releases](https://nodejs.org/en/about/previous-releases)). The [October 2026 security releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) ship fixes for 22.x (22.23.4), 24.x (24.22.1) and 26.x (26.12.1) only. 20.x receives no fixes.
- `.github/workflows/ci.yml:80` and `.github/workflows/deploy-ponder.yml:53`: `node-version: "22"`, a floating major. Each run resolves whatever 22.x is latest, so the gates are not tied to a recorded version.
- Gates therefore run on 22.x while the indexer and svm-ingest images run on 20.x. A green CI run says nothing about the runtime that executes the deployed code.
- `package.json` has no `engines` field. There is no `.nvmrc` or `.node-version`. The Vercel runtime is set only in the project settings, outside the repository.
- `package.json:156`: `@types/node` `^22.14.1`.
- `README.md:85`: `Node.js 20+`.
- Images and both Node-using workflows activate pnpm through corepack (`Dockerfile.ponder:3`, `Dockerfile.svm-ingest:3`, `ci.yml:86`, `deploy-ponder.yml:59`; `package.json:175` declares `packageManager` `pnpm@10.6.5`), so the chosen line must still bundle corepack.

## Decision

Node.js **24 LTS** (end of life 2028-04-30 per the [release schedule](https://github.com/nodejs/Release/blob/main/schedule.json)). One owner: a `.node-version` file holding an exact `x.y.z` of at least **24.22.1**, with parity enforced by policy:

- CI and deploy workflows read the version with `node-version-file`.
- Both Dockerfiles pin the exact `node:<x.y.z>-alpine` tag; a policy asserts it equals `.node-version`.
- `engines.node` holds the same major (for Vercel); the policy asserts it.
- The `@types/node` major equals the runtime major; the policy asserts it.

The implementation PR registers choke-point id **`node-version-file`** in `lib/architecture/chokepoints.ts` with owner file `.node-version`.

A version bump is one PR that changes the owner. The parity policy stays red until every consumer matches. No bots.

## One rejected alternative and why

Pin **22.23.4** and stay on 22.x. Rejected: 22.x reaches end of life on **2027-04-30** ([release schedule](https://github.com/nodejs/Release/blob/main/schedule.json)), so a second migration would follow within about six months.

## Consequences

The implementation PR must prove:

- Compatibility of Ponder, svm-ingest, Hardhat 3 and native dependencies on 24.x.
- An explicit reindex needed / not needed verdict with the reason.
- corepack + `pnpm@10.6.5` activation in the images and in CI on the chosen line.
- Negative controls, red before green: a Dockerfile `FROM node:20-alpine`; a workflow with a literal `node-version`; an `engines.node` major that differs from the owner.

After that PR merges, the maintainer sets the Vercel project Node.js version to the owner's major if the project setting overrides `engines`, rebuilds the indexer and svm-ingest images, and records the change in `docs/ops/deploys/`.

## Status

Proposed
