# 0015 — Per-deployment Ponder schema, own-schema reads, no views

Supersedes [ADR 0014](./0014-per-deployment-ponder-schema.md), including its Amendment.

## Context

Measured on `25689e1` against the installed `ponder@0.18.2` (`node_modules/ponder`). The maintainer verified the views facts on a local checkout ([#69 finding](https://github.com/kargain-com/kargain/issues/69#issuecomment-6500961048)).

1. **`build_id` excludes the namespace.** It is `sha256(BUILD_ID_VERSION, config, schema, indexing)` (`src/build/index.ts:567–572`). The schema name and the views schema are not inputs, so the same image can start against any schema name.
2. **A schema belongs to one app.** If a schema holds another `build_id`, `ponder start` throws `MigrationError` (`src/database/index.ts:906–916`), and the same happens for another minor version (`:898–904`). With the same `build_id`, the start is a crash recovery: it waits for the lock heartbeat to expire, reverts unfinalized rows, and resumes from the checkpoint (`:918–960`).
3. **Readiness belongs to the writer's own schema.** `/ready` is 200 only when that schema's `_ponder_meta.is_ready = 1` (`src/server/index.ts:88–100`). The writer sets that after backfill completes (`src/runtime/omnichain.ts:564–615`).
4. **Ponder's own read pool is scoped to the writer's schema.** It sets `search_path` to the writer's schema (`src/utils/pg.ts:142–170`), and `db` from `ponder:api` reads that schema.
5. **The product's raw SQL bypasses that pool.** Raw SQL runs on its own `pg.Pool(DATABASE_URL)` and qualifies tables with the literal `kargain.`. This is the only tie between the product and a fixed schema name:
   - `src/lib/ponder-passport-entity.ts`;
   - `src/lib/ponder-passport-custody.ts`;
   - `src/lib/ponder-passport-provenance.ts`;
   - `src/lib/passport-entity-browse-sql.ts`;
   - `src/lib/ponder-read-path-ready.ts`.

   These modules run only inside the Ponder process (`src/api/**`). Nothing outside it reads Ponder tables from Postgres; the app reads over HTTP (`lib/web3/ponder-fetch-transport.ts`).
6. **ADR 0014 was built on a wrong premise.** It added a deploy-owned views schema because it read Ponder's view creation as non-atomic. That holds only for the `ponder db create-views` CLI (`src/bin/commands/createViews.ts`, no transaction). The runtime path is one transaction (`src/database/actions.ts:262–275`). Either way, a views schema exists only to keep the `kargain.` literals of item 5. Without the literals, no views are needed.
7. **Measured on the server, 2026-10-29.** The schema `kargain` is 2.4 MB. Docker Compose is 2.26.1. The tunnel targets `http://ponder:42069`. One Base Sepolia provider serves the indexer, under a continuous rate limit (#60).

## Decision

### a. One schema per deployment
- Every writer started by a deploy uses `DATABASE_SCHEMA=k_<40-hex commit>`.
- The pre-existing writer keeps its schema `kargain` until retention removes it.
- No writer sets `DATABASE_VIEWS_SCHEMA` or `--views-schema`. A policy asserts this.

### b. Each writer reads only its own schema
- One owner in `src/lib` supplies the table qualifier from the writer's `DATABASE_SCHEMA`, validated as `^k_[0-9a-f]{40}$` or `kargain`, and refuses otherwise.
- Every `kargain.` literal of Context §5 goes through that owner. A policy forbids the literal in `src/**`.
- This changes `build_id`, which is expected: the first deploy of this change is the first switch (§f).

### c. HTTP front
- The Compose service `ponder` becomes pinned nginx (tag and digest), with `resolver 127.0.0.11 valid=10s` and a variable upstream (ADR 0014 §c, unchanged).
- Writers are `ponder-blue` and `ponder-green`, on the internal network only.
- A flip rewrites the upstream include and runs `nginx -s reload`. On failure, the include is restored and nginx reloaded again.

### d. Deploy sequence (under the ADR 0010 lock)
1. **Pending precedence.**
   - A pending deployment whose `/ready` is 200 is switched first.
   - A not-ready pending is superseded (stop it, drop its schema) when the incoming executable differs from the pending's.
   - With the same executable, the run waits up to 600s for 200, with no teardown. If 200 arrives, it switches. Otherwise it re-asserts `switch=pending` and exits 0.
2. **Start.** Build `kargain-ponder:<commit>`, run the ADR 0012/0013 preflight on the slot, and start the free slot on `k_<commit>`. Record it as `pending`.
3. **Answer.** The new writer must answer `/ready` with any status within 90s. Otherwise `ponder_did_not_become_ready`: tear down the new writer and its schema, clear `pending`, and exit 1. This applies only to a writer started in this run.
4. **Ready.** Wait up to 600s for `/ready` 200. On a miss, print `deploy_evidence switch=pending schema=k_<commit>` and exit 0, with the writer left running.
5. **Switch.** Flip nginx to the new slot and require 200 through nginx within 90s, then stop the previous live writer. On failure: `deploy_switch_failed: http`, upstream restored, old writer untouched.

- **Unchanged.** When the incoming executable equals `live.executable`, the run starts nothing (`outcome=unchanged`).
- **Live collision.** A run never starts a second writer on the live schema. If `k_<commit>` is live with a different executable, the live slot restarts in place with the new image. The `build_id` is the same, so this is a crash recovery (Context §2).
- **`hold`.** Runs steps 1–4 and never step 5. A ready pending is reported, not switched.

### e. Rollback
- The previous live writer is kept stopped, with its schema and image, as the only spare.
- `rollback` does four things:
  1. start the spare on its own schema with its own image (crash recovery, Context §2);
  2. wait 600s for `/ready` 200, or print the pending line and exit 0, finishing on a later dispatch;
  3. flip nginx;
  4. stop the failed writer.
- One model. No dual-serve, no lag measurement. Reason: one rate-limited provider (#60). A second writer runs only while a new deployment backfills.

### f. First switch from today's single writer
- **Pre-cutover** means the container of Compose service `ponder` is the legacy writer, not the pinned nginx image. This is observed on every run.
- In this phase a `push` run changes nothing and prints `deploy_evidence cutover=awaiting_dispatch` (carried over from the ADR 0014 Amendment). Only `workflow_dispatch` starts or completes it.
- **First `hold` or `deploy`:**
  - tag the legacy writer's image `kargain-ponder:legacy` and record it;
  - start the new writer on blue (§d 2–4).
- **Switch when ready:**
  1. stop the legacy container;
  2. `docker compose up -d ponder` brings up nginx with the upstream on blue;
  3. require 200 through nginx.

  Downtime is the container swap, in seconds. There is no schema rename and no views.
- **The spare.** The legacy writer becomes the spare on schema `kargain` with image `kargain-ponder:legacy`. Its own code reads `kargain.`, which is its own schema, so §e applies unchanged.

### g. Images and slots
- A slot runs a commit by tagging `kargain-ponder-<slot>` to `kargain-ponder:<commit>`, then `docker compose up -d --no-build`.
- Images of live, spare, and pending are kept. The others are removed after a successful switch.
- Dangling-image prune and `docker builder prune -f --filter until=72h` stay.

### h. Retention
- After a successful switch, drop every deployment schema except live, spare, and pending. The writer of a dropped schema is stopped first.
- `kargain` is dropped by exact name once it is neither live nor spare.
- Never touched: `ponder_sync`, `ponder_rpc_cache_1`, `kargain_svm_raw`, `kargain_svm_projection`.

### i. State
- One owner writes the state file.
- Fields: `live`, `spare`, `pending`, `nginx_config_digest`.
  - `live` and `pending` are `{slot, schema, commit, executable, image}`.
  - `spare` is `{schema, commit, executable, image}`. It runs in whichever slot is not live, after any pending is superseded.
  - `commit` is null only for the legacy spare (schema `kargain`).
- **Pre-cutover input.** Today's file shape (`identity`, `executable`) is accepted only while pre-cutover is observed. The first write replaces it with this shape.
- Fail-closed: an unknown field, a missing or unreadable file, two refs sharing a slot or schema, or a state that disagrees with the observed containers (§f phase, running slots) is `deploy_state_invalid` and changes nothing.
- A changed nginx config digest recreates only `ponder` (`proxy=recreated`).

### j. Unchanged
ADR 0010 (lock, pinned SHA), ADR 0012/0013 (preflight), ADR 0011 (`ponder_sync` and the RPC cache are never dropped). ADR 0014 §g, which moves svm-ingest modules out of the indexing glob, stays with #70.

## One rejected alternative and why

**Ponder's built-in views schema, keeping the `kargain.` literals.**
- On every start, a writer re-creates the views after backfill (Context §6). A restarted older writer, for example under `restart: always`, silently takes the views back.
- The first switch would still need a rename of the table schema `kargain`, with downtime equal to the new writer's recovery.
- It keeps two read paths (views and own schema) inside one process.

Removing five literals removes the views and all three problems.

## Consequences

- **Implementation scope.**
  - The §b owner and policy;
  - the nginx front;
  - the plan, executor, state, and retention owners per §d–§i;
  - removal of `scripts/ponder-reindex.sh` / `.sql`.

  The PR #71 branch is a source for the nginx front, the readiness probe modes, and the state and retention owners. Its views switch, legacy service, lag sampler, rollback decider, and phase-by-base-tables logic are not carried over.
- **Constructed controls (red, then green).**
  - an `src/**` `kargain.` literal;
  - `DATABASE_VIEWS_SCHEMA` set on a writer;
  - a switch before `/ready` 200;
  - a ready pending superseded;
  - a not-ready pending kept beside a new start of a different executable;
  - a teardown of a pending not started in this run;
  - a push run that mutates pre-cutover;
  - retention selecting a protected schema, or the live or spare schema;
  - a literal `proxy_pass` hostname;
  - a state with two refs on one slot;
  - an upstream left on the new slot after a failed flip.
- **Local Docker rehearsal.** Real slot images from `Dockerfile.ponder` indexing a local Hardhat chain, from base `25689e1`'s single writer, all through `ponder-deploy.sh`. Target: under 20 minutes end to end.
  1. push pre-cutover → `awaiting_dispatch`, nothing changed;
  2. `hold` → blue pending, then ready;
  3. `deploy` → first switch, with HTTP answered through nginx and the downtime measured;
  4. `rollback` → legacy spare serving;
  5. `deploy` → switch again;
  6. a second commit that changes `build_id` → switch, with retention dropping `kargain`;
  7. restart of the live writer without an nginx reload → HTTP back within 10s;
  8. a not-ready pending superseded by a newer commit;
  9. state file removed → `deploy_state_invalid`.
- **Maintainer steps.**
  - ADR 0014 §i (size) and the tunnel target are already done (#69).
  - The §e measurement is not needed.
  - After merge: `hold`, then `deploy`, by `workflow_dispatch`.

## Status

Proposed. The maintainer's merge of the PR that adds this file is the acceptance. ADR 0014 then becomes `Superseded by 0015`.
