# S9-B Solana commercial cutover

## Scope

Final S9-B unit: Solana Devnet namespace `2000040168` enters `COMMERCIAL_ACTIVE`, `svm-ingest` becomes the live append-only writer for that network, and startup refuses when the configured RPC cannot serve the required cursor slot.

Accepted design (do not reopen):

- Start cursor owner is `resolveIngestStartSlot()` = `min(blocks.*)` over the six commercial program start slots on the Solana `COMMERCIAL_ACTIVE` row. The SVM registry row carries **no** single precomputed `indexFromBlock` mirror. Gitignored `deployments/svm-40168.json` is deploy-machine equality assert only — not a VPS runtime input.
- First-run catch-up is `bootstrap_state = historical_backfill`, distinct from post-bootstrap `catchup_window_exceeded`.
- Bootstrap completes only when the cursor reaches observed head and the service enters normal follow mode (`bootstrap_state` cleared to null).
- Retention refusal text: `svm-ingest RPC retention unavailable: required slot ${requiredSlot} is before first available block ${firstAvailableBlock}`.

## Registry and evidence

- Runtime source: `COMMERCIAL_ACTIVE` Solana row (program ids + `blocks` slots)
- Deploy-machine evidence (assert only): `deployments/svm-40168.json`
- Namespace / EID: `2000040168` / `40168`
- RPC measured at implementation: `SOLANA_RPC_URL=https://api.devnet.solana.com`
  - `getFirstAvailableBlock = 116113408`
  - `getSlot(confirmed) = 493947281`
  - required start slot `490463509` retained

## Founder enable (execution order)

### 1. Deploy the cutover commit on the VPS

- **Changes:** app + indexer + `svm-ingest` image sources now include the Solana commercial row and bootstrap/retention ingest code.
- **Verify:** `git rev-parse HEAD` matches the accepted cutover commit; `git status` clean for tracked paths.
- **Undo:** `git checkout` / `git reset --hard` to the pre-cutover commit (founder controls push/revert). Product registry reverts with that commit.

### 2. Confirm runtime inputs

- **Changes:** none yet — read-only gate.
- **Verify:**
  - `.env` has `SOLANA_RPC_URL` (the endpoint `svm-ingest` will actually use), `SVM_INGEST_EID=40168`, and the Postgres URL shared with Ponder
  - Optional confirm: `SVM_INGEST_NAMESPACE` unset or equal to `2000040168`
  - No requirement to copy `deployments/svm-40168.json` onto the host
- **Undo:** n/a (no mutation).

### 3. Build and start `svm-ingest`

- **Changes:** applies / creates `kargain_svm_raw` (incl. `ingest_cursor.bootstrap_state`) and writes append-only raw rows; projects into `kargain_svm_projection` inline after raw insert. Does **not** re-run EVM `ponder-reindex.sql`.
- **Verify:**
  ```bash
  docker compose build svm-ingest
  docker compose up -d --force-recreate svm-ingest
  curl -s http://127.0.0.1:42100/live
  ```
  Expect `/live` OK while bootstrap may still be in progress.
- **Undo:** `docker compose stop svm-ingest` (leaves schemas intact).

### 4. Watch bootstrap clear

- **Changes:** cursor advances from `min(blocks) - 1` through historical backfill; `bootstrap_state` stays `historical_backfill` until head is reached, then clears.
- **Verify:**
  ```bash
  curl -s http://127.0.0.1:42100/ready | python3 -m json.tool
  ```
  During backfill: `status: "not_ready"`, `bootstrapState: "historical_backfill"`, `incident: null`.
  After catch-up: `status: "ready"`, `bootstrapState: null`, `incident: null`.
  If retention fails at boot, refuse with both numbers in logs / refusal detail (`requiredSlot`, `firstAvailableBlock`) and `/ready` 503 with `incident: "startup_retention_unavailable"`.
- **Undo:** stop the service; do **not** drop `kargain_svm_raw` to “fix” bootstrap.

### 5. Confirm read path and product surfaces

- **Changes:** none new — proves the live row is reachable through existing owners.
- **Verify:**
  - Indexer: `GET /read-path-ready` → 200
  - Browse: `GET /consignments?limit=1` → 200
  - Detail: open a known passport / listing detail URL on the app against the same indexer
  - Optional integrity: `pnpm svm-projection:replay-digest`
- **Undo:** n/a for these checks; product reachability undoes with commit revert (step rollback below).

### 6. Token before / after — `28764749040560770193485982315422230450798602`

- **Changes:** none — evidence capture for the three-network walk.
- **Verify:**
  - **Before cutover (recorded):** public custody read returned `custodyUnresolved: "unknown_namespace"` because EID `40168` had no commercial namespace.
  - **After cutover:** same token must **not** fold to `unknown_namespace`. Expected served-network outcome is a custody answer or a different named gap (e.g. `departure_without_arrival` if only the send side is observed). Capture:
    - HTTP passport/custody JSON for the token
    - VPS SQL on `kargain.bridge_crossing` for the token (`peer_layer_zero_eid`, `peer_namespace` / refusal columns) — these raw rows must explain the old `unknown_namespace`
    - VPS SQL on `kargain.custody_determining_event` for stream-B shape only (not a second fold owner)
- **Undo:** n/a (observational).

### 7. Three-network walk + Solana explorer click-check

- **Changes:** none — product walk after ingest is ready.
- **Verify:**
  - Passport minted / present on Solana Devnet, visible through browse and detail with the other two commercial networks still answering.
  - Custody / bridge chrome for a cross-network passport does not invent a fourth network and does not leave Solana as `unknown_namespace`.
  - **Explorer finger-check (do not skip):** registry `explorerBaseUrl` is `https://explorer.solana.com`. Solana Explorer scopes Devnet via `?cluster=devnet`. From a Solana passport or tx chrome, open “View on explorer” for an address and for a signature. Pass only if the opened page is the Devnet view of that account/tx — not a mainnet “not found”. Fail closed on a screenshot of mainnet emptiness; do not argue from URL construction alone.
- **Undo:** n/a (observational). Product reachability undoes with commit revert (rollback below).

## Rollback (returns platform to pre-cutover product state)

1. **Stop ingest** — `docker compose stop svm-ingest`.  
   Verify: `/live` unreachable / container stopped.  
   Undo of this step: start the service again.

2. **Revert the cutover commit** (or redeploy the previous commit) so `COMMERCIAL_ACTIVE` no longer lists Solana and product write/read owners stop dispatching the SVM commercial arm.  
   Verify: app/indexer build is the pre-cutover revision; Solana namespace absent from commercial registry.  
   This is what restores pre-cutover **product** behavior.

3. **`kargain_svm_raw` is never dropped as part of rollback.** Leave `kargain_svm_raw` and `kargain_svm_projection` intact. Ponder reindex does not own those schemas. Dropping them is a separate, intentional rebuild decision — not rollback.

4. **Optional later rebuild (not rollback):** only if deliberately discarding the backfill, stop ingest, drop both SVM schemas, restart from evidence `min(deploySlot)`. That is a new enable, not undoing this cutover.
