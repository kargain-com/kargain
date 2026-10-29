# 0014 — One Ponder schema per deployment, stable read surface

## Context

Measured on `732a95fc` with Ponder **0.18.2** from the installed package (`node_modules/ponder`, same contents as `pnpm-lock.yaml` `ponder@0.18.2`). Official guide: [Deploy to production](https://ponder.sh/docs/production/deploy). Related: [#47](https://github.com/kargain-com/kargain/issues/47), [#50](https://github.com/kargain-com/kargain/issues/50) / [ADR 0012](./0012-deploy-preflight.md), [#60](https://github.com/kargain-com/kargain/issues/60), [#66](https://github.com/kargain-com/kargain/issues/66), [ADR 0010](./0010-serialized-pinned-deploys.md), [ADR 0011](./0011-ponder-0-18-upgrade.md), [ADR 0013](./0013-preflight-rate-limited.md), [`docs/ops/deploys/r4-deploy-restore.md`](../ops/deploys/r4-deploy-restore.md).

```bash
node -p "require('./node_modules/ponder/package.json').version"
nl -ba node_modules/ponder/src/build/index.ts | sed -n '52p;116,126p;244,271p;291,300p;324,366p;422,487p;567,573p'
nl -ba node_modules/ponder/src/database/index.ts | sed -n '898,934p'
nl -ba node_modules/ponder/src/server/index.ts | sed -n '88,122p'
nl -ba node_modules/ponder/src/runtime/omnichain.ts | sed -n '596,619p'
nl -ba node_modules/ponder/src/bin/ponder.ts | sed -n '88,145p'
nl -ba node_modules/ponder/src/bin/commands/createViews.ts | sed -n '196,292p'
nl -ba node_modules/ponder/src/drizzle/onchain.ts | sed -n '43p'
nl -ba node_modules/ponder/src/sync-store/schema.ts | sed -n '36,39p'
rg -n "DATABASE_SCHEMA: kargain|DATABASE_SCHEMA=kargain|DROP SCHEMA IF EXISTS kargain CASCADE|FROM kargain\.|kargain\.(consignment|passport)|Schema: kargain|table_schema = 'kargain'" \
  --glob '!node_modules/**' --glob '!.git/**'
nl -ba docker-compose.yml | sed -n '27,58p'
nl -ba Dockerfile.ponder
nl -ba test/ponder-reindex-svm-isolation-policy.test.ts | sed -n '1,65p'
nl -ba scripts/lib/ponder-identity-fingerprint.ts | sed -n '42,48p'
nl -ba scripts/lib/ponder-executable-fingerprint.ts | sed -n '13,27p'
nl -ba scripts/lib/ponder-readiness-probe.ts | sed -n '8,10p'
nl -ba .github/workflows/deploy-ponder.yml | sed -n '94,169p'
rg -n 'DATABASE_SCHEMA' .env.example
python3 - <<'PY'
from pathlib import Path
files=[]
for p in Path('src').rglob('*'):
    if p.suffix not in {'.js','.mjs','.ts','.mts'} or p.name.endswith('.d.ts'): continue
    rel=str(p).replace('\\','/')
    if '/api/' in rel or rel.startswith('src/api/'): continue
    if '.test.' in p.name or '.spec.' in p.name: continue
    files.append(rel)
print(f'total={len(files)} svm-ingest={sum(1 for f in files if "svm-ingest" in f)}')
for f in sorted(files): print(f)
PY
```

Every Ponder deployment today reuses one fixed database schema. When Ponder’s `build_id` changes, the new image refuses to start with `MigrationError`, and the indexer stays down until the maintainer drops the schema by hand and the backfill completes. Indexer schema, reindex and deploy are pause classes, so this ADR comes first. Implementation is a follow-up PR after this ADR is merged.

### 1. Ponder 0.18.2 `build_id` inputs

Installed version: **0.18.2** (`node -p "require('./node_modules/ponder/package.json').version"`).

`build_id` is computed in `node_modules/ponder/src/build/index.ts`:

- `BUILD_ID_VERSION = "2"` (`:52`).
- Final digest (`:567–573`):

  ```text
  sha256(BUILD_ID_VERSION + configContentHash + schemaContentHash + indexingContentHash).slice(0, 10)
  ```

- **Config content hash** (`:291–300`): `superjson.stringify` of `{ ordering, contracts, accounts, blocks }` only. `chains` (RPC URLs, `ethGetLogsBlockRange`) are **not** hashed.
- **Schema content hash** (`:324–329`): raw file bytes of `ponder.schema.ts` (the schema file is also executed first).
- **Indexing content hash** (`:333–366`): concatenation of the **file contents** of every match of `src/**/*.{js,mjs,ts,mts}`, ignoring `src/api/**` and `**/*.{test,spec}.{js,mjs,ts,mts}` (`:116–126`, `:334–336`). Comment at `:351–352`: hashing is file contents, not exports.
- **Matched files are executed** before hashing via `executeFileWithTimeout` (`:339`, definition `:244–271`, 10s timeout). A file under the glob that throws at import fails the build, not only the hash.
- On this tree the glob covers **33** files, **7** of them under `src/svm-ingest/` (list from the `python3` block above). `Dockerfile.ponder:7` is `COPY . .`, so those files are present in the production image and enter both execution and the hash. This supersedes the 0.16.6 measurement on `#47` (35 files / 9 under `src/svm-ingest/`).

### 2. Schema selection, views, MigrationError, crash recovery, `/ready`

- **Schema:** `DATABASE_SCHEMA` or `--schema` is required for `ponder start` (`build/index.ts:422–435`). Max length **45** (`drizzle/onchain.ts:43`; enforced at `build/index.ts:466–479`).
- **Views schema:** `--views-schema` on `start` (`bin/ponder.ts:91–95`) or `DATABASE_VIEWS_SCHEMA` (`build/index.ts:436–437`). Cannot equal the indexing schema; cannot be a reserved sync schema name (`:439–463`).
- **`ponder db create-views`:** exists (`bin/ponder.ts:129–145`). Requires both `--schema` and `--views-schema`. For each table it runs a separate `DROP VIEW IF EXISTS` then `CREATE VIEW … AS SELECT * FROM "<schema>"."<table>"` (`bin/commands/createViews.ts:196–264`), each in its own `adminQB.wrap` — **not** one Postgres transaction. It then creates the live-query notify procedure in the views schema and a trigger on the deployment schema’s `_ponder_checkpoint` (`:269–292`). During that loop a concurrent reader can see a missing view or a mix of old and new targets.
- **When views are created on `start`:** if `viewsSchema` is set, the omnichain runtime runs `createViews` **after** historical backfill and **before** setting `is_ready=1` (`runtime/omnichain.ts:596–619`). Multichain and isolated controllers mirror that order. This ADR does **not** use that path (or the CLI) for the live flip — see Decision §b.
- **MigrationError** (`database/index.ts:898–916`): prior app minor `version` mismatch, or (non-platform) `dev` **or** `previousApp.build_id !== buildId` → `Schema "…" was previously used by a different Ponder app. Drop the schema first, or use a different schema.`
- **Crash recovery with the same `build_id`:** after version match and unlock, logs `Detected crash recovery` with that `build_id` and resumes from checkpoints (`:929–934` and following). A changed `build_id` never takes this path.
- **`/ready`:** HTTP **200** when `_ponder_meta.value.is_ready === 1`; otherwise **503** `"Historical indexing is not complete."` (`server/index.ts:88–101`). `is_ready` is set to `1` only after backfill (and optional auto views) (`omnichain.ts:611–619`).
- **`/status`:** JSON per chain with `block.number` and `block.timestamp` (Unix seconds from the checkpoint) (`server/index.ts:103–122`). Lag for Decision §e is in **seconds**: head block timestamp from the same provider minus that `block.timestamp`.
- **Reserved sync schemas** (must never be used as indexing or views schema names): `ponder_sync`, `ponder_rpc_cache_1` (`sync-store/schema.ts:36–39`). Active RPC cache after ADR 0011 is `ponder_rpc_cache_1`.

Today’s deploy readiness probe still treats **any** answered HTTP status as success within **90s** (`scripts/lib/ponder-readiness-probe.ts:8–10`; ADR 0010). That proves the process answered, not that indexing reached realtime.

### 3. Literal references to schema `kargain`

Command and full output on this base:

```text
docker-compose.yml:42:      DATABASE_SCHEMA: kargain
src/lib/passport-entity-browse-sql.ts:150: * SQL expression: consignment Asking → USD 1e8 (alias `c` on kargain.consignment).
src/lib/passport-entity-browse-sql.ts:392:  return `kargain.consignment c
src/lib/ponder-passport-provenance.ts:157:    FROM kargain.passport_record
src/lib/ponder-passport-provenance.ts:195:    FROM kargain.passport_uri_history
src/lib/ponder-passport-custody.ts:83:     FROM kargain.custody_determining_event
src/lib/ponder-passport-custody.ts:94:     FROM kargain.bridge_crossing
src/lib/ponder-read-path-ready.ts:18:  "kargain.consignment",
src/lib/ponder-read-path-ready.ts:19:  "kargain.passport",
src/lib/ponder-read-path-ready.ts:20:  "kargain.passport_record",
src/lib/ponder-read-path-ready.ts:21:  "kargain.passport_uri_history",
src/lib/ponder-read-path-ready.ts:127:    FROM kargain.consignment c
src/lib/ponder-read-path-ready.ts:131:    FROM kargain.custody_determining_event
src/lib/ponder-read-path-ready.ts:139:    FROM kargain.bridge_crossing
src/lib/ponder-passport-entity.ts:126:FROM kargain.passport`;
test/ponder-read-path-ready.test.ts:26:CREATE TABLE IF NOT EXISTS kargain.passport (
test/ponder-read-path-ready.test.ts:65:CREATE TABLE IF NOT EXISTS kargain.passport_record (
test/ponder-read-path-ready.test.ts:75:CREATE TABLE IF NOT EXISTS kargain.passport_uri_history (
test/ponder-read-path-ready.test.ts:103:CREATE TABLE IF NOT EXISTS kargain.consignment (
test/ponder-read-path-ready.test.ts:144:    "kargain.consignment",
test/ponder-read-path-ready.test.ts:145:    "kargain.passport",
test/ponder-read-path-ready.test.ts:146:    "kargain.passport_record",
test/ponder-read-path-ready.test.ts:147:    "kargain.passport_uri_history",
test/ponder-read-path-ready.test.ts:217:      FROM kargain.consignment c
test/ponder-reindex-svm-isolation-policy.test.ts:39:  assert.ok(!writerSrc.includes("DROP SCHEMA IF EXISTS kargain CASCADE"));
test/ponder-kargain-physical-columns-policy.test.ts:5: * Measured against a Ponder-created `DATABASE_SCHEMA=kargain` Postgres:
test/ponder-kargain-physical-columns-policy.test.ts:111:  it("kargain.passport SELECT list ≡ physical names from JS→snake_case", () => {
test/ponder-kargain-physical-columns-policy.test.ts:112:    const cols = extractSelectListBeforeFrom(entity, "kargain.passport");
test/ponder-kargain-physical-columns-policy.test.ts:124:    const redSql = `SELECT id, "chainId" AS chain_id FROM kargain.passport`;
test/ponder-kargain-physical-columns-policy.test.ts:127:      extractSelectListBeforeFrom(redSql, "kargain.passport"),
test/fixtures/entity-pg-pool.ts:19:CREATE TABLE IF NOT EXISTS kargain.passport (
test/fixtures/entity-pg-pool.ts:135:const EVM_INSERT = `INSERT INTO kargain.passport (
test/fixtures/ponder-kargain-physical-columns.ts:2: * Physical column names on Ponder 0.16 `DATABASE_SCHEMA=kargain` tables.
test/fixtures/ponder-kargain-physical-columns.ts:6: * Ponder-created Postgres (`DATABASE_SCHEMA=kargain`):
test/fixtures/ponder-kargain-physical-columns.ts:7: *   information_schema.columns for kargain.passport includes `chain_id`
test/fixtures/ponder-kargain-physical-columns.ts:8: *   (not `chainId`); `SELECT "chainId" FROM kargain.passport` →
lib/commerce/browse-source.ts:3: * Ponder `kargain.consignment` is the only catalog today (EIP-155 commercial).
scripts/ponder-reindex.sql:20:-- Schema: kargain (set via DATABASE_SCHEMA in docker-compose.yml)
scripts/ponder-reindex.sql:26:DROP SCHEMA IF EXISTS kargain CASCADE;
scripts/e2e-local.sh:112:export DATABASE_SCHEMA=kargain
docs/adr/0011-ponder-0-18-upgrade.md:250:DROP SCHEMA IF EXISTS kargain CASCADE;
docs/indexer/MIGRATION-V2.md:21:| … handlers on `kargain.passport` only; …
docs/indexer/OPERATIONS.md:53:**Physical column casing (Ponder 0.16):** `DATABASE_SCHEMA=kargain` …
docs/indexer/OPERATIONS.md:57:WHERE table_schema = 'kargain' AND table_name = 'passport'
```

Additional product literals outside that pattern (same schema name): `src/lib/ponder-read-path-ready.ts:22–23` (`kargain.bridge_crossing`, `kargain.custody_determining_event`); matching DDL/asserts in `test/ponder-read-path-ready.test.ts:85`, `:95`, `:148–149`. `.env.example:167` comments `# DATABASE_SCHEMA=kargain` (compose hard-sets it today).

**Not** Postgres app-schema literals: Compose **network** name `kargain` (`docker-compose.yml:101`); database name `kargain_ponder`; Irys metadata tags `app=kargain`; package name `kargain`.

**How each resolves after this decision:** product SQL and tests that qualify `kargain.*` keep that qualifier and read the **stable views schema** named `kargain` (Decision §b). `DATABASE_SCHEMA` on a deployment becomes `k_<commit>` (Decision §a). `scripts/ponder-reindex.sql` / `.sh` are replaced (Decision §h). Docs that prescribe `DROP SCHEMA kargain` for a `build_id` change are superseded by this ADR for that purpose.

### 4. HTTP path and concurrent deployments

- `ponder` publishes `127.0.0.1:42069:42069` (`docker-compose.yml:43–44`).
- `cloudflared` runs `tunnel --no-autoupdate run` with `TUNNEL_TOKEN`, `depends_on: ponder`, same Compose network (`:48–58`). Tunnel **ingress** is configured outside the repository.
- The app reaches Ponder over that HTTP path. Switching deployments must switch the HTTP route as well as SQL views.

Two concurrent Ponder deployments on one host require at least: **two Compose services** (distinct names), **two container publish ports** (or only a proxy published on the address the tunnel already uses), **two distinct `DATABASE_SCHEMA` values**, shared `postgres` and network `kargain`. `svm-ingest` (`:42100`) stays a separate service.

### 5. Measured backfill and RPC budget

- **Intact cache (~1 minute):** [#47](https://github.com/kargain-com/kargain/issues/47#issuecomment-6491287172) (2026-10-29): schema `kargain` dropped only; `ponder_rpc_cache_1` and `ponder_sync` intact; Ponder started 07:56:26 UTC; both chains at head by ~07:57 UTC; `/ready` 200. Same facts in [#66](https://github.com/kargain-com/kargain/issues/66).
- **Cache dropped (~11 hours):** [`docs/ops/deploys/r4-deploy-restore.md`](../ops/deploys/r4-deploy-restore.md) — after `ponder_sync` was dropped on 2026-10-25, the 0.18.2 recreate ([run 40582691842](https://github.com/kargain-com/kargain/actions/runs/40582691842), 2026-10-27 20:58 UTC, `ready` status 503) reached `/ready` 200 at 2026-10-28 07:41 UTC.
- **Concurrent RPC budget:** [#60](https://github.com/kargain-com/kargain/issues/60) — about **66** rate-limited log lines per minute on the sole Base Sepolia provider (`docker compose logs --since 30m ponder | grep -ciE '429|rate limit'` → 1984 / 30 min).

A per-deployment schema can therefore reach `/ready` 200 inside one deploy step **when the shared cache is never dropped**. Address / start-block / schema changes miss the cache and need the ~11-hour path; #47 required that the switch not be trapped inside one 30-minute SSH step. Start and switch are therefore separate (Decision §d).

### 6. Schemas that must never be dropped by any deploy step

Pinned by `test/ponder-reindex-svm-isolation-policy.test.ts:16–31`, `:48–64` (and projection isolation `:34–40`):

- `ponder_sync`
- `ponder_rpc_cache_1`
- `kargain_svm_raw`
- `kargain_svm_projection`

Ponder also reserves the first two as sync schema names (`sync-store/schema.ts:36–39`). Retention and deploy steps must never `DROP` them.

### Boundary with ADR 0012 / #50

[ADR 0012](./0012-deploy-preflight.md) preflight refuses configuration and RPC-capability errors between `build` and `up`, while the old container keeps serving. It deliberately does **not** refuse on a `build_id` mismatch (identity fingerprint is a superset of `build_id` inputs). That refusal class belongs to this design: a new deployment schema absorbs a new `build_id` without dropping the live one. Preflight still runs **before** the new deployment starts, under the ADR 0010 lock, while the old deployment keeps serving.

Today `scripts/ponder-reindex.sh` stops Ponder and drops schema `kargain`, then tells the operator to `docker compose up` **outside** the deploy lock (`scripts/ponder-reindex.sh:19–31`). That path is what this ADR replaces for `build_id` changes.

## Decision

One schema per Ponder deployment, a stable views schema for all product SQL, start separated from switch, an atomic views cutover, a fixed nginx proxy as the tunnel target, and every svm-ingest-owned module out of Ponder’s build inputs.

### a. Deployment schema naming

- **Derived from:** the deploy commit already pinned by [ADR 0010](./0010-serialized-pinned-deploys.md) (`DEPLOY_SHA` / `github.sha`).
- **Format:** `k_<40-char lowercase hex of that commit>` (length **42**, ≤ 45).
- **Why commit, not the executable digest:** Ponder’s production docs list a git commit hash as a common automation choice; deploy evidence already prints `deploy_evidence commit=…`; a 64-char executable digest would need an arbitrary truncation. Recreate still happens only when the executable fingerprint changes; the schema name correlates with the commit that built the image.
- **Same-commit collision:** if `k_<DEPLOY_SHA>` is already the **live writer** schema (recorded in the deploy state file / running compose), do **not** start a second writer on that schema. Print:

  ```text
  deploy_evidence outcome=unchanged
  deploy_evidence schema=k_<sha>
  deploy_evidence reason=live_schema
  ```

  If the executable digest requires recreate **and** the schema name is already live, recreate **that single** deployment in place (one writer only). Never two writers on one schema. This covers the 2026-10-29 re-run of deploy run 40773454611 (attempt 2) for a commit already live.

### b. Stable read surface (atomic switch)

- **Name:** `kargain` — as the **views** schema after the first cutover (Decision §j), not as the indexing schema of a live writer.
- **When:** only after the new deployment’s `/ready` returns **200**. The new deployment **starts without** auto `--views-schema` / `DATABASE_VIEWS_SCHEMA`.
- **Do not** use `ponder db create-views` (or `ponder start --views-schema`) for the live flip. Context §2: that CLI issues per-view `DROP`/`CREATE` outside one transaction (`createViews.ts:196–264`) and then notify/trigger DDL (`:269–292`), so concurrent product SQL can error or mix old and new targets.
- **Deploy-owned atomic flip:**
  1. Build the full view set (every app table, `_ponder_meta`, `_ponder_checkpoint`) plus the live-query notify procedure (same SQL shape as `createViews.ts:196–279`) and the trigger on `"k_<sha>"."_ponder_checkpoint"` (same shape as `:281–292`) in a **staging** schema named `kargain_views_next`, each view `SELECT * FROM "k_<sha>"."<table>"`.
  2. In **one** Postgres transaction (deploy owns the connection):

     ```sql
     BEGIN;
     ALTER SCHEMA kargain RENAME TO kargain_views_prev;
     ALTER SCHEMA kargain_views_next RENAME TO kargain;
     COMMIT;
     ```

  3. Drop schema `kargain_views_prev` only when it held the previous **views** (not a deployment schema with tables). HTTP flip (Decision §c) runs only after `COMMIT`.
- **Why this is atomic:** PostgreSQL `ALTER SCHEMA … RENAME` is transactional DDL ([ALTER SCHEMA](https://www.postgresql.org/docs/current/sql-alterschema.html)). Concurrent sessions see either the pre-commit or post-commit catalog, not a half-replaced view set. Notify functions move with the staging→`kargain` rename (function OID remains valid on the trigger).
- **Item 3 literals:** every product SQL qualifier `kargain.*` keeps reading through those views. Compose stops hard-coding `DATABASE_SCHEMA: kargain` as the writer schema after the first cutover.

### c. HTTP switch (named proxy)

- **Software:** **nginx** as a Compose service — the tunnel’s constant target. It alone publishes the host address pattern used today for `:42069` (`docker-compose.yml:43–44`); Ponder deployment services stay on the internal network (distinct service names and ports).
- **Pin:** exact image **tag and digest** in `docker-compose.yml` (literal pin, same spirit as [ADR 0009](./0009-node-runtime-single-owner.md) for Node images). Policy asserts the pin. **Forbidden:** `nginx:latest` or any floating tag.
- **DNS re-resolution:** Ponder services use Compose `restart: always` (`docker-compose.yml:32`). A crash-restart can change the container’s address on the Compose network. A static `proxy_pass http://<service>:<port>` resolves the name once (at start or reload) and would keep a stale address until the next deploy. The nginx config therefore:
  1. Sets `resolver 127.0.0.11 valid=10s;` (Docker’s embedded DNS; [`resolver`](http://nginx.org/en/docs/http/ngx_http_core_module.html#resolver)).
  2. Passes the upstream through a **variable** (e.g. `set $ponder_upstream http://<service>:<port>;` then `proxy_pass $ponder_upstream;`) so nginx re-resolves on the `valid=` interval ([`proxy_pass` with variables](http://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass)).
  - **Forbidden:** a literal hostname in `proxy_pass` without a variable (no re-resolve on container IP change).
- **Flip:** write the upstream service name and port into that variable’s source, then `nginx -s reload` (graceful; in-flight requests finish — [Controlling nginx](http://nginx.org/en/docs/control.html)). **Forbidden:** kill/restart of nginx to flip (drops in-flight).
- **Evidence** after a successful flip:

  ```text
  deploy_evidence proxy=upstream <service>:<port>
  ```

- **Reject:** editing Cloudflare tunnel ingress on every deploy.
- **Maintainer steps outside the repository (one-time, before the first dual-serve cutover):**
  1. Confirm tunnel ingress targets the nginx service’s published port (same published pattern the app already uses).
  2. Do not change ingress per deploy after that.

### d. Deploy sequence under ADR 0010’s lock (start ≠ switch)

Under `.deploy.lock` / `flock -w 900` and SSH `command_timeout: 30m` (ADR 0010; `deploy-ponder.yml:92–101`). Start and switch are separate so an uncached ~11-hour backfill (Context §5; #47) can complete.

**Pending precedence (every run, before any start):** under the lock, after Decision §a collision check:

1. If `pending_schema` is set and that deployment’s `/ready` is already **200:** **switch it first** (atomic views + nginx, Decision §b / §c), clear `pending_schema`, print success evidence. Only then continue this run’s start path for a newer commit if one is required.
2. If `pending_schema` is set and `/ready` is **not** 200: **supersede** it — stop that container, `DROP SCHEMA` that pending `k_*` only, clear `pending_schema`. Retention does not keep superseded pendings.
3. If no pending: continue.

A later `workflow_dispatch` with no new executable still takes only the switch half when a ready pending exists (step 1) or re-asserts `switch=pending` when it is not ready (no supersede without a newer start).

**Start path** (push or `workflow_dispatch` when a new executable must run; after pending precedence):

1. **Build** the new image.
2. **ADR 0012 / 0013 preflight.** On refusal: existing `deploy_preflight … verdict=refused` / `deploy_evidence outcome=refused`; exit non-zero; live keeps serving.
3. **Start the new deployment beside the live** with `DATABASE_SCHEMA=k_<DEPLOY_SHA>`, without views-schema. Record `pending_schema=k_<DEPLOY_SHA>` in the state file. Live keeps answering HTTP through nginx.
4. Poll the new deployment’s `/ready` for **200** every 2s for **600s**. Justification for attempting an in-run switch: measured ~1 minute with intact cache (#47 / #66) × ~10 under #60. Gate is **200 only**, not ADR 0010’s any-status process probe.
5. **If `/ready` is 200 within 600s:** run the atomic views switch (Decision §b), then nginx flip (Decision §c). Clear `pending_schema`. Apply Decision §e for whether the previous writer stays up. Print success evidence below.
6. **If `/ready` is not 200 within 600s:** leave the new deployment running; live keeps serving; exit **0** (not a failed deploy) with:

   ```text
   deploy_evidence switch=pending schema=k_<sha>
   ```

**On hard failure (old keeps serving):**

| Step | Named failure |
|------|----------------|
| Preflight refuse | `deploy_evidence outcome=refused` (ADR 0012) |
| New never answers HTTP after start | process-answered probe failure (existing named ready timeout); tear down the new container and its `k_*` schema; clear pending |
| Atomic views or nginx flip fails after ready | `deploy_switch_failed: <views\|http>` — leave proxy on old; leave previous per Decision §e; tear down new only if it never became the live HTTP target |

**Success evidence** (exact formats; plus existing recreated / commit / node / preflight lines):

```text
deploy_evidence schema=k_<sha>
deploy_evidence views=kargain
deploy_evidence switch=ready status=200
deploy_evidence switch=views
deploy_evidence switch=http
deploy_evidence proxy=upstream <service>:<port>
deploy_evidence rollback_model=<keep_previous|restart_previous>
```

The Ponder executable-unchanged path (no new schema) is unchanged, except Decision §a when the digest matches and the schema is already live.

### e. Rollback after a switch (dual-serve criterion and fallback)

Two Ponder processes share the sole Base Sepolia provider (Context §5 / #60, ~66 rate-limited lines/min with one). Dual-serve is expected to roughly double contention. The default model and the fallback are selected by a **measured criterion** before the first production cutover; the chosen model is recorded in the deploy state file (`rollback_model=keep_previous` or `rollback_model=restart_previous`).

**Lag definition (one unit for both chains):** at a sample, for each commercial chain,

```text
lag_seconds = head.timestamp − status[chain].block.timestamp
```

where `status[chain].block.timestamp` comes from live Ponder `/status` (Context §2; `server/index.ts:112–118`) and `head.timestamp` is the `timestamp` field of `eth_getBlockByNumber("latest")` from the **same** provider used for that chain. A negative value is treated as **0**. The bound is in **seconds** and is the **same** number for Base Sepolia and Ethereum Sepolia (block-time asymmetry must not change the pass line).

**Measurement session (same sitting, before first production cutover):**

1. **Single-writer baseline** — only the live deployment writing. Window **30 minutes**, sample every **10 minutes** (three samples). For each sample, record `lag_seconds` on both chains. Let `L_single_max` be the maximum of those six values.
2. **Dual-serve** — start the previous (or a second) writer beside the live one. Window **30 minutes**, sample every **10 minutes**. Record `lag_seconds` on both chains each time.

**Bound:** `B = L_single_max + M`, with margin `M = max(L_single_max, 30)`. Justification for `M`: Context §5 / #60 — dual-serve roughly doubles contention on the sole Base Sepolia provider; allowing a second full single-writer peak of lag is that doubled budget. The **30s** floor avoids a zero-tolerance bound when single-writer samples were always at head (`L_single_max = 0`), while still failing a multi-minute dual lag that a bare “≤ 64 blocks” would have accepted on Ethereum Sepolia (~12s blocks).

**Pass** only if **every** dual-serve sample has `lag_seconds ≤ B` on **both** chains. **Fail** if any sample on either chain exceeds `B`. Record `L_single_max`, `M`, and `B` next to `rollback_model` in the deploy state file so the bound is auditable.

**Default when the criterion passes — `keep_previous`:** after a successful switch the previous deployment **keeps running** until the next successful switch of a newer commit (then stop that spare and apply retention).

**Rollback under `keep_previous`** (previous already `/ready` 200):

1. Atomic views flip back to the previous deployment schema (same staging + `ALTER SCHEMA` transaction as Decision §b, targeting `k_<previous_sha>`).
2. nginx upstream → previous; `nginx -s reload`.
3. Stop the failed **new** deployment only.

Bound: **60s**. Named failure: `deploy_rollback_failed: waited 60s`.

**Fallback when the criterion fails — `restart_previous`:** after a successful switch, **stop** the previous deployment (only current writes). Rollback then:

1. Start the previous deployment against `k_<previous_sha>` (crash recovery / realtime catch-up).
2. Wait until its `/ready` is **200**, bound **600s** (same intact-cache justification as Decision §d; if the spare’s ranges are cold, use `switch=pending` style and a later `workflow_dispatch` to finish rollback — do not tear it down on the 600s miss).
3. Atomic views + nginx flip to previous.
4. Stop the failed new deployment.

Named failure if the restart path’s hard steps miss their bounds: `deploy_rollback_failed: waited 600s` (or `60s` for the views/HTTP half after ready). Evidence line records the active model:

```text
deploy_evidence rollback_model=keep_previous
```

or

```text
deploy_evidence rollback_model=restart_previous
```

### f. Retention

- After a **successful** switch: `DROP SCHEMA … CASCADE` every prior **deployment** schema (`k_<40-hex>`) except **current** and **previous** (rollback spare). Stop containers for dropped schemas. At most two deployment schemas + their writers remain beside the protected set.
- A **pending** schema is kept until switched, superseded (Decision §d pending precedence, not-ready branch), or replaced. Superseded pendings are dropped immediately, not retained.
- **Never** drops the schemas in Context §6. No recurring manual chore.

### g. All svm-ingest-owned modules out of Ponder’s build inputs

Proven against Context §1: the indexing glob includes and **executes** every `src/**/*.{js,mjs,ts,mts}` outside `src/api` and tests. Identity already names the non-Ponder set (`scripts/lib/ponder-identity-fingerprint.ts:43–48`):

- `src/svm-ingest/`
- `src/lib/svm-raw-writer.ts`
- `src/lib/svm-projection-writer.ts`

Implementation must ensure the Ponder image tree does not place **any** of those paths under `src/` where that glob can see them (Dockerfile copy list and/or Ponder-build `.dockerignore`; directory layout changes are allowed if they achieve the same proof). Executable graph already excludes `src/svm-ingest/` (`ponder-executable-fingerprint.ts:27`); the two writer files must not remain reachable via the glob even though they sit under `src/lib/` today.

Effect: changes to any svm-ingest-owned module stop changing Ponder’s `build_id` and stop being executed at Ponder build. (The 2026-10-28 outage was `src/svm-ingest/main.ts` alone — #47 / #66; the writers are the same class of defect.)

### h. What replaces `scripts/ponder-reindex.sh` / `.sql`

A `build_id` change must **never** need a manual schema drop. The deploy opens `k_<new sha>`, leaves it to backfill (possibly `switch=pending`), and switches when `/ready` is 200 (Decision §d), retaining per §f.

Those scripts’ `DROP SCHEMA IF EXISTS kargain CASCADE` procedure (`scripts/ponder-reindex.sql:26`; wrapper `scripts/ponder-reindex.sh`) is **retired** by the implementation PR. Contract address / schema / start-block identity changes take the same start/pending/switch path (uncached ranges use pending across runs), not a drop of the live views schema.

**Composition with [#55](https://github.com/kargain-com/kargain/issues/55):** #55 owns aligning runbook / `ponder:config` text with current RPC env keys; this ADR removes the drop-for-`build_id` path those scripts encode.

### i. Disk

Before implementation, the maintainer runs this **read-only** per-schema size measurement on the server database (via the postgres Compose service):

```sql
SELECT n.nspname AS schema,
       pg_size_pretty(COALESCE(SUM(pg_total_relation_size(c.oid)), 0)) AS total_size,
       COALESCE(SUM(pg_total_relation_size(c.oid)), 0) AS total_bytes
FROM pg_namespace n
LEFT JOIN pg_class c
  ON c.relnamespace = n.oid
 AND c.relkind IN ('r', 'i', 'm', 't', 'S')
WHERE n.nspname NOT LIKE 'pg_%'
  AND n.nspname <> 'information_schema'
GROUP BY n.nspname
ORDER BY COALESCE(SUM(pg_total_relation_size(c.oid)), 0) DESC;
```

Retention keeps at most **two** switched deployment schemas (plus at most one pending). Peak is about **2 ×** (or briefly **3 ×** with pending) one deployment schema’s measured size, plus Context §6. If that does not fit, stop and resize before the first dual-serve cutover.

### j. First cutover (today’s table schema `kargain` → views)

Today `kargain` holds **tables** (Context §3). Staging views can be built in `kargain_views_next` while those tables exist. The live name `kargain` cannot become views until the tables move.

One-time under the lock, after new `k_<new_sha>` is `/ready` 200:

1. Stop the **old** container (it still writes table schema `kargain`).
2. Build staging views + notify/trigger in `kargain_views_next` → `k_<new_sha>` (Decision §b step 1).
3. One transaction: `ALTER SCHEMA kargain RENAME TO k_<prior_sha>`; `ALTER SCHEMA kargain_views_next RENAME TO kargain`. Here `k_<prior_sha>` is the commit of the image that was live before cutover (or a recorded precut name of the same `k_<40-hex>` form if that commit is unavailable — stated in the state file).
4. nginx → new; evidence lines as in Decision §d.
5. `k_<prior_sha>` (tables) is the first-cutover rollback spare.

**First-cutover downtime:** bounded to stop → rename transaction → proxy flip (seconds in the local rehearsal), not the backfill. Later switches under `keep_previous` are zero-downtime; under `restart_previous` the previous writer is stopped after switch (Decision §e).

**First-cutover rollback:** stop new; reverse rename (move views `kargain` aside, restore table schema name `kargain`); start old against restored `kargain`; nginx → old.

## One rejected alternative and why

Keep one schema and only remove svm-ingest paths from Ponder’s build inputs (the alternative stated in #47). Rejected: `build_id` changes become rarer, but every legitimate schema or indexing change still means downtime plus a manual drop — the 2026-10-25 and 2026-10-28 outage class.

## Consequences

- **Implementation PR scope:** Compose dual Ponder services + pinned nginx with Docker DNS re-resolution; deploy pending-precedence then start/switch under the lock; deploy-owned atomic views transaction; same-commit collision rule; dual-serve lag criterion selecting `keep_previous` vs `restart_previous`; first-cutover migration; Dockerfile/build-context proof that `src/svm-ingest/`, `src/lib/svm-raw-writer.ts`, and `src/lib/svm-projection-writer.ts` are absent from Ponder’s indexing glob; retire `scripts/ponder-reindex.sh` / `.sql` as the `build_id` drop procedure; extend deploy / isolation policy tests.
- **Constructed controls (red before green):**
  - switching views or HTTP before `/ready` 200 fails;
  - a start-path run that **supersedes** a pending deployment already at `/ready` 200 (must switch-first) fails;
  - a start-path run that **keeps** a not-ready pending beside a new start (must supersede) fails;
  - nginx config with a literal `proxy_pass` hostname and no `resolver` / variable upstream fails;
  - non-atomic live flip fails its test;
  - retention that would drop Context §6 schemas fails;
  - Ponder image/context that still contains `src/svm-ingest/` or either svm writer under the indexing glob fails;
  - deploy script missing pending / success / proxy / `rollback_model` evidence lines fails;
  - starting a second writer when `k_<sha>` is already live fails;
  - under recorded `keep_previous`, stopping the previous writer on switch fails; under recorded `restart_previous`, leaving it running after switch fails.
- **Local Docker rehearsal** the implementation PR must show before any server deploy:
  - two deployments; ready-pending switched first then a newer start; not-ready pending superseded;
  - atomic switch under concurrent reads with no query error;
  - **restart the live Ponder container without an nginx reload;** HTTP recovers within the resolver `valid=` bound (10s);
  - dual-serve lag criterion: single-writer baseline then dual-serve, lag in **seconds** from `/status` `block.timestamp` vs head timestamp, one bound `B = L_single_max + max(L_single_max, 30)` for both chains (pass → `keep_previous` rollback within 60s; fail → `restart_previous` with `/ready` 200 gate);
  - first-cutover migration and its rollback; same-commit collision; retention dropping only older `k_*` schemas.
- **Maintainer steps outside the repository, in order:**
  1. Run the Decision §i size SQL; confirm two (briefly three with pending) deployment schemas fit.
  2. Run the Decision §e measurement session (single-writer baseline, then dual-serve; optionally the #60 `429` count). Record `L_single_max`, `M`, `B`, and `rollback_model=keep_previous` or `rollback_model=restart_previous` in the deploy state file from the result.
  3. One-time: point tunnel ingress at the nginx publish port (Decision §c).
  4. After the implementation merges: first production cutover under the deploy lock with `ponder_rpc_cache_1` / `ponder_sync` intact (Decision §j).

## Status

Superseded by [0015](./0015-per-deployment-ponder-schema-own-reads.md).
