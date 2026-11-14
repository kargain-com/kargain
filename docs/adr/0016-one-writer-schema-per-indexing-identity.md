# 0016 — One Ponder writer, one schema per indexing identity, automatic switch

Supersedes [ADR 0015](./0015-per-deployment-ponder-schema-own-reads.md).

## Context

Measured on `4434034` against `ponder@0.18.2`. The package tarball's integrity equals the `pnpm-lock.yaml` entry, and line numbers refer to the package's `src/`. Background: [#73](https://github.com/kargain-com/kargain/issues/73) (the ADR 0015 implementation, stopped), [r16](../ops/deploys/r16-ponder-build-id-outage.md), [r18](../ops/deploys/r18-planned-reindex.md).

**Ponder: what a schema is bound to**

1. **A schema name is required, and it is not part of `build_id`.**
   - Ponder refuses to start when neither `DATABASE_SCHEMA` nor `--schema` is set (`src/build/index.ts:422–433`).
   - It refuses the names `ponder_sync` and `ponder_rpc_cache_1` (`:447–453`; `src/sync-store/schema.ts:36–39`) and names longer than 45 characters (`:466–472`; `src/drizzle/onchain.ts:43`).
2. **A schema belongs to one `build_id`.**
   - On an empty schema, Ponder creates its objects (`src/database/index.ts:732`).
   - A schema written by another database-format version or another `build_id` is a `MigrationError`, raised inside the migration transaction before any write (`:899–917`).
   - With the same `build_id`, the start is a crash recovery: it waits for the previous lock (`:919–927`, `:1019–1038`), reverts unfinalized rows, and resumes from the checkpoint (`:929–1007`).
   - The lock expires 25s after the last heartbeat (`src/internal/options.ts:95–96`). A clean shutdown releases it at once (`src/database/index.ts:354–362`).
   - Every start writes `is_ready: 0` (`:721–730`), so `/ready` is 503 until the writer catches up. Rows already in the schema stay readable.
3. **What `build_id` covers** is `sha256(BUILD_ID_VERSION, config, schema, indexing)` (`src/build/index.ts:567–573`), where:
   - `config` is the *evaluated* `contracts`, `accounts`, `blocks` and `ordering` objects (`:291–300`). Values computed from the environment at start are included; RPC transports are not.
   - `schema` is the text of `ponder.schema.ts` (`:324–329`).
   - `indexing` is the text of each file in the indexing glob, without the modules those files import (`:351–366`).
   - `BUILD_ID_VERSION` is a constant (`:52`), and the database-format `VERSION` is `"6"` (`src/database/index.ts:144`). A Ponder patch upgrade changes neither. For example, 0.18.6 changed how some logs are decoded ([ponder#2450](https://github.com/ponder-sh/ponder/pull/2450)), yet upgrading to it keeps the `build_id`.

   So the same `build_id` can index differently: after an edit to an imported module, or a Ponder or dependency upgrade. A crash recovery then appends rows made by the new code to rows made by the old code. **`build_id` decides which schema Ponder will accept. It does not identify the code that wrote the rows.**
4. **Start order.** `ponder start` migrates the schema (`src/bin/commands/start.ts:223`) and the sync store (`:229`), then creates the HTTP server (`:299`). A `MigrationError` or a build error therefore leaves the process with no HTTP answer, which the ADR 0010 answered probe detects.
5. **Readiness and reads.**
   - `/ready` is 200 only when the writer's own schema has `is_ready = 1` (`src/server/index.ts:88–101`; set at `src/runtime/omnichain.ts:614`).
   - Ponder's own read pool is scoped to the writer's schema (`src/utils/pg.ts:156`, `:167`).
   - `ponder serve` runs the API alone on an existing schema (`src/bin/commands/serve.ts:162–178`). The [self-hosting guide](https://ponder.sh/docs/production/deploy) recommends it for read load, with the same schema as the writer.
6. **`ponder db prune` cannot do retention here.** It drops every schema without a live lock (`src/bin/commands/prune.ts:187–194`), including a stopped previous writer.

**Repository: hidden inputs to the writer**

7. **The indexing config reads the server environment.** `buildPonderIndexingConfig` resolves start blocks and addresses through `scripts/lib/ponder-env.ts` and `scripts/lib/resolve-sepolia-stack.ts`. Each source below overrides the committed registry:
   - start blocks from `PONDER_START_BLOCK_84532`, `PONDER_START_BLOCK` and `PONDER_START_BLOCK_11155111` (`ponder-env.ts:83–110`, and again `resolve-sepolia-stack.ts:53–63`);
   - hub addresses from `PONDER_KAR_PASSPORT_ADDRESS` and six more `PONDER_*_ADDRESS` keys (`resolve-sepolia-stack.ts:128–162`);
   - `deployments/<chainId>.json` before `COMMERCIAL_ACTIVE` (`:183–198`), from a directory that `KARGAIN_DEPLOYMENTS_DIR` can move (`scripts/lib/load-deployment.ts:24`).

   Production sets the start blocks in the server `.env` (`docs/indexer/OPERATIONS.md:18–19`). Their values equal the registry (`lib/web3/commercial-active.ts:314`, `:410`). Compose adds `latest` defaults (`docker-compose.yml:40–41`). The same runbook warns against changing these values after a backfill (`OPERATIONS.md:165`): changing them changes `build_id` (item 3).

   **One key, two facts.** The hub override reads the same keys that name the local Hardhat addresses: `ponderLocalAddresses` (`scripts/lib/load-deployment.ts:353–362`) and `scripts/lib/print-local-env.ts:11–15`, which exports them for local runs. With `PONDER_ENABLE_LOCAL=1` and without `PONDER_LOCAL_ONLY`, the Base Sepolia hub is therefore indexed at the localhost addresses.

   Deploy manifests are deploy-machine evidence outside the runtime graph (#20, #32), yet the indexing config reads them at runtime.
8. **The image takes in untracked files.** `Dockerfile.ponder:7` is `COPY . .` from the server checkout. `.dockerignore` excludes neither `deployments/*.json`, which `.gitignore:24–26` ignores, nor other local output (#76). `git checkout --force` leaves untracked files in place. The image can therefore differ from its commit.
9. **Product reads count as indexing code.** The raw-SQL readers live in `src/lib/`, inside Ponder's indexing glob (`scripts/lib/ponder-indexing-glob.ts:14–17`). An edit to a reader changes `build_id`.
10. **The raw SQL names the schema.** It runs on its own `pg.Pool` and qualifies Ponder tables with the literal `kargain.`:
    - `src/lib/ponder-passport-entity.ts:126`
    - `src/lib/ponder-passport-custody.ts:83`, `:94`
    - `src/lib/ponder-passport-provenance.ts:157`, `:195`
    - `src/lib/passport-entity-browse-sql.ts:392` (comment at `:150`)
    - `src/lib/ponder-read-path-ready.ts:18–23`, `:127`, `:131`, `:139`

    The owner that removes these literals exists on the PR #75 head `43251c5`: `src/lib/ponder-writer-schema.ts`, its five consumers and their tests. The `kargain_svm_projection.` names belong to svm-ingest.
11. **The deploy today** (`.github/workflows/deploy-ponder.yml`):
    - the schema is fixed in Compose (`docker-compose.yml:42`);
    - the state is read and written with host `python3` (`:92–98`, `:145`);
    - the identity digest only prints a warning (`:119–125`);
    - the probe runs from a host `scripts/` mount (`:108–111`, `:140–143`);
    - SSH `command_timeout` is `30m` (`:77`);
    - the manual reindex drops `kargain` by name (`scripts/ponder-reindex.sql:26`).
12. **Measured.**
    - With the RPC cache intact, a full backfill takes seconds. On 2026-10-30, backfill started at 12:37:00 and live indexing at 12:37:13 UTC; `/ready` answered 503 at 12:37:02 (r18).
    - CI `gates` take about 8 minutes (r16). Deploy jobs top out near 3 minutes, and the lock wait is 900s (ADR 0010).
13. **Why this replaces ADR 0015.**
    - Both outages came from `build_id` changes caused by edits that were not indexing (r4, r16). #78 removed that class.
    - A legitimate `build_id` change still needs a manual drop.
    - Zero-downtime blue/green is a mainnet requirement, and mainnet is closed until SPEC §7.6 Phase 2 and §7.7.
14. **Executable model of this decision.** The state machine below was explored exhaustively, up to five consecutive runs:
    - a crash after every mutation, then a host reboot or a bare `docker compose up`;
    - commits that change only the API, commits that change indexing, commits that never answer, and rollbacks.

    Results:
    - **This ADR's machine:** 113,634 runs over 79,418 distinct states, with no violation of four properties: no schema created by an image of another identity; no refusal caused by crashes alone; current and previous retained; the writer answering after success.
    - **Controls:** three planted defects were each caught (no write-ahead record, retention dropping the previous schema, bootstrap writing state first).
    - **An earlier draft** that paired a writer tag with a deploy-written schema file had two failures. A crash during a return, followed by a bare `docker compose up`, started the old image on the new commit's not-yet-created schema and created that schema under the wrong `build_id`. Several crash points also left every later run refusing.

## Decision

One writer. A schema holds the rows of exactly one indexing identity. The writer's image carries its schema. One pointer, the writer tag, says which image runs. The previous ref is kept for a rollback.

### a. The writer is a function of its commit

- **Clean build context.** The deploy builds from `git archive "$DEPLOY_SHA"` piped to `docker build`, never from the working tree. Untracked files cannot reach the image (Context §8).
- **Registry-only indexing, in every mode.** The Ponder indexing config and `pnpm ponder:config` resolve commercial chains from `COMMERCIAL_ACTIVE` only.
  - Removed from that path: the commercial start-block keys, the hub address override, and `deployments/<chainId>.json` (Context §7).
  - `PONDER_*_ADDRESS` then name the local Hardhat addresses only, and `PONDER_START_BLOCK_31337` the local start only. Local mode (`PONDER_ENABLE_LOCAL=1`) adds the localhost chain and changes nothing on commercial chains.
  - The deploy-machine asserts that compare manifests with the registry stay as they are.
- **Deploy refusals.** The ADR 0012 preflight refuses:
  - a removed key that is still set, or a `PONDER_*_ADDRESS` key, which only local mode reads (`reason=removed_env_key`, with the key). A leftover therefore cannot look effective;
  - local mode (`reason=local_mode_set`).

  Compose drops its start-block defaults.
- A start block or an address defines which rows exist, so it changes through a reviewed change to the registry, never through a server edit. The start-block parsing duplicated across two modules goes away with that path.
- **Result:** with these two rules, `build_id` is a function of the files in the image (Context §3).

### b. Two identities, one owner

The Ponder executable fingerprint owner computes both digests from one graph walk, over the image's own tree:

- **Indexing identity.** The static-import closure of `ponder.config.ts`, `ponder.schema.ts` and every indexing-glob file, plus `Dockerfile.ponder`, `pnpm-lock.yaml`, and the runtime slice of `package.json`. It covers every input of `build_id` (with §a) and all code reachable from indexing handlers, the Ponder version included.
- **Executable identity.** The indexing identity's files plus the `src/api/index.ts` closure and `docker-compose.yml`. A policy asserts that its file set contains the indexing set.

The identity fingerprint is deleted; the indexing identity replaces it with a definition that is a sound key.

### c. Schema and image

- **Schema.** `k_` plus the first 40 hex of the indexing identity. That is 42 characters, within Ponder's limit.
- **Base image.** `kargain-ponder:deploy`, built from the clean context of `DEPLOY_SHA`.
- **Writer image.** `kargain-ponder:<commit>`, derived from the base image by a two-line build: `FROM <base image ID>`, then `ENV DATABASE_SCHEMA=<schema>`. Labels carry the commit and both identities. Each writer image therefore carries its own schema.
- **Writer tag.** The `ponder` service runs `kargain-ponder:writer`. Re-pointing that tag (`docker tag`) is atomic, and it is the only pointer that changes which image runs. `build:` stays for local use. Deploy Compose calls use `--no-build`.
- **No override.** Compose sets no `DATABASE_SCHEMA`, and neither may the server `.env`. The preflight refuses a `DATABASE_SCHEMA` in the env Compose resolves for `ponder` (`reason=database_schema_override`).
- Ponder accepts an image only on its own schema (Context §2), and §a makes that schema mean one identity. A schema is therefore never created by another identity, whatever the timing.

### d. Own-schema reads

- One owner in `src/lib` returns the writer's schema from `DATABASE_SCHEMA`, validated as `^k_[0-9a-f]{40}$` or exactly `kargain`. It builds quoted qualified names. A missing or invalid value is a named error at first use.
- Every literal of Context §10 goes through it. A policy forbids the `kargain.` qualifier in `src/**`. Tests and fixtures create tables through the same owner.
- The owner is registered in `lib/architecture/chokepoints.ts`.
- It works unchanged under `ponder serve` (Context §5).
- Source: PR #75, ported onto `master`. Its branch predates #78.

### e. Tooling and host

- Tooling runs in a one-off service `ponder-deploy`: image `kargain-ponder:deploy`, Compose profile `deploy`, the same `env_file` and `environment` as `ponder`, the Compose network only, and `.ponder-deploy/` mounted.
- It runs the digests (§b), the preflight, the state owner, retention's schema drops, and the probes against `http://ponder:42069/ready`.
- The host shell uses only `git`, `flock` and `docker`. Docker observations are handed to the tooling as files, and the tooling prints single values the shell uses verbatim.
- The runner no longer installs dependencies or computes digests for the deploy job.

### f. State

- One owner writes `.ponder-deploy/state.json`, which is gitignored and written by replace-on-rename. It replaces `.ponder-deploy-fingerprints`.
- **Shape:** `{current, previous, switching}`. `current` is a ref; `previous` and `switching` are each a ref or null. A ref is `{commit, image, indexing, executable}`. The legacy ref has `commit` and `indexing` null, and its schema is `kargain`. Every other ref's schema is derived from `indexing`.
- **Two refs may share a schema** only if they share `indexing`.
- **Observation** with `switching` null, before any mutation:
  - the container's image ID equals those of `kargain-ponder:writer` and `current.image`;
  - its effective `DATABASE_SCHEMA` equals the image's `ENV` and `current`'s schema;
  - the images of `current` and `previous` exist.
- **Fail-closed.** A missing or unreadable file, an unknown or missing field, refs that break the sharing rule, or a disagreeing observation → `deploy_state_invalid: <detail>`, and nothing changes.
- **First run.** Accepted only when `state.json` is absent, `.ponder-deploy-fingerprints` is present, and the running container's `DATABASE_SCHEMA` is `kargain`. In this order:
  1. Derive `kargain-ponder:legacy` from the running container's image with `ENV DATABASE_SCHEMA=kargain`.
  2. Point the writer tag at it, recreate, and require the answered probe. This is a crash recovery on the same schema, and it exercises the new mechanism before any switch.
  3. Write `{current: legacy, previous: null, switching: null}`, with `executable` taken from the old file.
  4. Delete the old file.

  A crash before step 3 repeats the first run. `kargain` becomes the first `previous` at the first switch.

  *Correction (2026-11-13):* if the probe in step 2 is not answered, the run prints `ponder_did_not_become_ready` and exits 1 without writing `state.json` or deleting the old file, so the next run repeats the first run. There is no image to return to: the legacy image is the running image on the schema it already ran on.

### g. Switch

One procedure serves deploy, rollback and resumption. Under the ADR 0010 lock, for a target ref:

1. Write `switching: target`.
2. Point the writer tag at the target's image.
3. `docker compose up -d --no-build --force-recreate ponder`.
4. Require the ADR 0010 answered probe: any status within 90s.
5. **Answered → commit.** Write `{current: target, previous: <old current>, switching: null}`, run retention (§j), then wait up to 600s for `/ready` 200:
   - 200 → `deploy_evidence switch=ready status=200`, exit 0;
   - answering, not 200 → `deploy_evidence switch=catching_up status=<last>`, exit 0;
   - no answer at the deadline → `ponder_stopped_answering`, exit 1, with no automatic action.
6. **Not answered → return.** Print `ponder_did_not_become_ready`, point the tag at `current`, recreate, and require the answered probe.
   - Answered → write `switching: null`, run retention, print `returned` evidence (§k), exit 1.
   - Not answered → `deploy_return_failed`, exit 1, with `switching` left set.

**Resumption.** A run that finds `switching` set repeats steps 2–6 for it before its own operation. Steps 2–6 are idempotent: the tag is the only pointer, and every image carries its schema. A resumed commit prints `deploy_evidence resolved=committed`, skips the 600s wait, and the run continues. A resumed return ends the run as step 6 says.

When the target and `current` share a schema (same indexing identity), steps 3 and 6 are crash recoveries on that schema. Otherwise the target schema is new, or is a retained one of the same identity.

### h. Deploy

`operation=deploy` covers every push and the default dispatch.

1. Build the base image (§c). Compute both identities in `ponder-deploy` and validate the state (§f). Every run builds; the dependency layer is cached.
2. **Unchanged.** If the executable identity equals `current.executable`, nothing starts. The run prints the ADR 0010 `unchanged` evidence plus `schema=`, then runs retention.
3. **Otherwise:**
   - run the preflight (a refusal keeps its ADR 0012 lines and exits before any mutation);
   - derive `kargain-ponder:<DEPLOY_SHA>`;
   - switch to `{commit, image, indexing, executable}`.

   Same indexing identity → a restart in place. A new one → a new schema, backfilled from the RPC cache.

### i. Rollback

`workflow_dispatch` with input `operation: rollback`:

- It needs `previous` (otherwise `deploy_rollback_failed: no_previous`) and its image (otherwise `deploy_rollback_failed: previous_image_missing`).
- It switches to `previous` without a preflight, because the preflight evaluates the deploy commit, not the previous image.
- That ref's schema was written by its own identity, so the start is a crash recovery.
- After the commit, `previous` is the ref rolled back from.

### j. Retention

Retention runs after every commit, return or unchanged run, under the lock.

- **Schemas.** Drop every schema named `k_<40 hex>` or exactly `kargain` that is not `current`'s or `previous`'s. Only those owned names are ever selected, so `public`, `ponder_sync`, `ponder_rpc_cache_1`, `kargain_svm_raw` and `kargain_svm_projection` cannot be. `ponder db prune` is not used (Context §6).
- **Images.** Remove every `kargain-ponder` tag except those of `current`, `previous`, `writer` and `deploy`. The dangling prune and `docker builder prune -f --filter until=72h` stay.
- A schema left behind by an interrupted run is harmless: its name is its identity, so a later start on it is a crash recovery of the same code.

### k. Evidence and time limits

- **First line:** `deploy_evidence operation=<deploy|rollback>`.
- **`recreated`:**
  - `preflight=ok` (on deploys that ran it), then `outcome=recreated`;
  - `commit=<sha|legacy>`, `schema=<observed>`, `indexing=<digest|none>`, `executable=<digest>`;
  - `build_id=<read from the schema's _ponder_meta>`, `node=<from the writer>`, `ready=ponder status=<answered status>`;
  - then the `switch=` line.
- **`returned`:** `outcome=returned`, then `commit`, `schema`, `ready` of the restored writer.
- **Resumption:** `resolved=committed`.
- **Failures:** `ponder_did_not_become_ready` · `ponder_stopped_answering` · `deploy_return_failed` · `deploy_state_invalid: <detail>` · `deploy_rollback_failed: <no_previous|previous_image_missing>`. The ADR 0010 and 0012 lines are unchanged.
- Each line is printed after the step that proves it. `legacy` and `none` name an absence; nothing is invented.
- **Time limits.** The whole run holds the lock. SSH `command_timeout` becomes **45m**: lock 15m + build and preflight about 3m + a resumption up to 3m + answer 1.5m + ready 10m ≈ 32.5m.

### l. Removed

- `scripts/ponder-reindex.sh` and `.sql`. Their svm-schema guarantee moves to the retention policy.
- The identity fingerprint, its test, and the deploy warning.
- `.ponder-deploy-fingerprints`, the host `python3` state code, and the host `scripts/` mount.
- The runner's fingerprint, Node and install steps in the deploy job.
- Compose's `DATABASE_SCHEMA` and start-block lines.

### m. Unchanged

- ADR 0010: concurrency group, lock, pinned SHA, master guard.
- ADR 0012/0013: preflight verdicts.
- ADR 0011: `ponder_sync` and the RPC cache are never dropped.
- The deploy `paths` coverage policy (#80, #83).

## One rejected alternative and why

**A schema per commit, with the schema passed through a deploy-written env file next to the writer tag.** That was the earlier draft of this ADR.

- **The key is unsound.** The same commit can produce another `build_id` through the server env or untracked files (Context §7–§8). A rollback, a re-run or a recreate after an `.env` edit then hits `MigrationError` on the commit's own schema.
- **Two pointers are not atomic.** The executable model found a crash plus a bare `docker compose up` that created a new schema under the old `build_id`, and crash points that left every later run refusing (Context §14).
- **It re-indexes on every API-only change.** A per-commit schema has to backfill again even when no indexing code changed.

The same reasons rule out keying by `build_id`: it cannot be computed before the start, and it does not identify the code that wrote the rows (Context §3).

## Consequences

- **What the product sees.**
  - **Executable-only change:** a restart in place, seconds of 503 on `/ready`, with the data intact.
  - **Indexing change:** a container swap plus a cached backfill, under a minute. The app reads the new schema while it fills, so lists are briefly incomplete; the app does not gate on readiness today.
  - **Uncached backfill** (a new chain, an earlier start block, a lost cache): catching-up data until 200. The maintainer schedules such changes.
- **Lock contention.** A run that uses the full 600s wait holds the lock for up to about 17 minutes, and an svm-ingest deploy then waiting can time out (`deploy_lock_not_acquired`). It is re-run by dispatch.
- **Rollback.**
  - It runs `gates` first, about 8 minutes.
  - Deploy runs share one concurrency group, so a newer pending run replaces an older pending one (ADR 0010). A merge right after a rollback dispatch can replace it.
  - After a rollback, the next deploy of `master` ships `master` again; the fix goes forward.
- **Server preconditions (maintainer, before the implementation merges):**
  - remove `PONDER_START_BLOCK_84532`, `PONDER_START_BLOCK_11155111`, `PONDER_START_BLOCK` and any `PONDER_*_ADDRESS` from the server `.env`. The start-block values equal the registry, so the indexed range is unchanged;
  - confirm that `.env` does not set `DATABASE_SCHEMA`.
- **The merge is the first run (§f):** a restart onto the derived legacy image, then a switch to a new schema, about a minute in total.
- **The future is not narrowed.**
  - Moving read-only modules from `src/lib/` to `src/api/` (Context §9) turns most product-read changes into restarts in place, with no change to this design.
  - Splitting reads into `ponder serve` on the same schema, and zero-downtime parallel backfill for mainnet, add a pending ref and a front to this state machine. Neither changes the schema key, the image binding or the own-schema owner.
  - Both are separate decisions.
- **Implementation scope** (one issue after acceptance):
  - §a: config owner, preflight codes, Compose, clean build context;
  - §b: digests in one owner;
  - §c and §e: images, Compose `ponder` and `ponder-deploy`, `.gitignore`;
  - §d: owner, consumers, tests, policy, chokepoint;
  - §f–§k: state, switch and retention owners, readiness modes `answered` and `ready200`, the rewritten `deploy-ponder.yml` with the `operation` input passed through `env`;
  - §l: removals and their references;
  - the documents this change invalidates, in the same PR: the operative sections of `docs/indexer/OPERATIONS.md` (manual drops, start-block and address keys, `hold`), `docs/indexer/README.md`, and `.env.example`. A runbook that still prescribes a manual drop would delete the rollback schema.

  #55 keeps `ponder:config`, `scripts/deploy.ts` and the singular-RPC policy. #76's reference to ADR 0015 §g becomes this ADR's §j.
- **Constructed controls** (red, then green):
  - an exhaustive crash-injection test drives the real state, switch and retention owners against a simulated Docker and Ponder world, not a second model of them. It asserts the four properties of Context §14, and the three planted defects turn it red;
  - a removed key, local mode, or a `DATABASE_SCHEMA` override, each refused by the preflight;
  - the indexing config identical with and without the removed keys and a planted `deployments/84532.json`;
  - an untracked file in the checkout absent from the image;
  - the indexing set not contained in the executable set;
  - a `kargain.` qualifier in `src/**`;
  - retention selecting a protected, current, previous or non-owned schema;
  - each `deploy_state_invalid` cause, including a moved writer tag;
  - `docker compose build ponder`, host `python3`, or a host `scripts/` mount in the deploy.
- **Local Docker rehearsal** through the real deploy script, with real images indexing Base Sepolia and Ethereum Sepolia through public keyless RPCs (*correction, 2026-11-13:* the preflight refuses local mode and commercial RPCs must be https, so a local chain cannot pass the real deploy script), starting from `master`'s writer on `kargain`. Target: under 20 minutes.
  1. First run: legacy adopted; switch to `k_<I1>`.
  2. An API-only commit: restart in place on `k_<I1>`.
  3. An indexing commit: switch to `k_<I2>`; `kargain` dropped.
  4. A no-op dispatch: `unchanged`.
  5. A commit whose writer fails at build: returned; its schema never created.
  6. `rollback`, then a deploy of `master`: crash recoveries on retained schemas.
  7. A run killed after step 3 of §g, followed by `docker compose up -d`: the next run resumes it.
  8. `state.json` removed: `deploy_state_invalid`, nothing changed.

## Status

Proposed. The maintainer's merge of the PR that adds this file is the acceptance. ADR 0015 then becomes `Superseded by 0016`.
