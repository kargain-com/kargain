# 0012 — Deploy preflight before replacing the running container

## Context

Measured on `ebfcfbc` with:

```bash
rg -n 'env_file:|environment:' docker-compose.yml
rg -n 'url=|detail=' scripts/ponder-rpc-probe.ts
rg -n 'throw new Error|Invalid start block|probe_requires_numeric_start_block' \
  scripts/lib/ponder-env.ts scripts/lib/ponder-rpc-probe.ts
rg -n 'fetch\(|AbortSignal|signal:' scripts/lib/ponder-rpc-probe.ts \
  src/svm-ingest/rpc-client.ts lib/svm/solana-json-rpc.ts
rg -n 'postSolanaJsonRpc' lib/web3/svm-rpc.ts lib/passport/simulate-passport-may.ts \
  src/svm-ingest/rpc-client.ts scripts/assert-svm-binary-identity.ts
rg -n 'flock|git checkout|docker compose build|docker compose up|STATE_FILE|image prune|deploy_evidence|unchanged|command_timeout' \
  .github/workflows/deploy-ponder.yml .github/workflows/deploy-svm-ingest.yml
rg -n 'SOLANA_RPC_URL|DATABASE_URL|SVM_INGEST_PORT|resolveIngest|resolveCatchup|resolveIngestMaxRps|throw new' \
  src/svm-ingest/main.ts lib/svm/ingest-config.ts
rg -n 'buildPonderRuntime' ponder.config.ts
rg -n 'commercialPonderProbeChainIds|SVM_COMMERCIAL_PROGRAM_CENSUS' \
  scripts/lib/ponder-rpc-probe.ts lib/svm/ingest-config.ts
nl -ba docker-compose.yml | sed -n '36,42p;80,90p'
nl -ba .github/workflows/deploy-ponder.yml | sed -n '89p;94,128p;141,161p'
nl -ba .github/workflows/deploy-svm-ingest.yml | sed -n '46p;51,79p'
nl -ba scripts/ponder-rpc-probe.ts | sed -n '19,24p'
nl -ba scripts/lib/ponder-rpc-probe.ts | sed -n '83,104p;143,145p;158,163p'
nl -ba scripts/lib/ponder-env.ts | sed -n '16,22p;44,64p;148,218p'
nl -ba src/svm-ingest/main.ts | sed -n '38,50p;77p'
nl -ba lib/svm/ingest-config.ts | sed -n '46,88p;98,109p;182,186p;244,299p'
nl -ba lib/svm/solana-json-rpc.ts | sed -n '13,33p'
```

On 2026-10-27 a Ponder deploy recreated the container while the server env still lacked a required commercial RPC list. The new image refused at `stage=config` (`missing_rpc_urls`), readiness timed out, and the indexer stayed down until a manual fix. A misconfiguration must stop the deploy and leave the old container running. This amends [ADR 0010](./0010-serialized-pinned-deploys.md).

- **Env resolution.** `docker-compose.yml` gives `ponder` and `svm-ingest` both `env_file: .env` (`:36`, `:80`) and an `environment:` block with interpolated defaults (`:38–42`, `:82–90`): `DATABASE_URL`, start blocks, svm-ingest EID and port. The values a container starts with are resolved by Compose, not by `.env` alone.
- **RPC addresses in logs.** `scripts/ponder-rpc-probe.ts:19–24` writes each provider URL and the error detail to stderr. Deploy logs of this public repository are public. Message text for `invalid_rpc_url` and `duplicate_rpc_url` also embeds the URL (`scripts/lib/ponder-env.ts:205`, `:213`).
- **Refusal codes today.** Refusals in `scripts/lib/ponder-env.ts` (`:156–213`) are plain `Error`s; the code exists only as a message prefix. `parseStartBlock` at `:21` also refuses env input (`Invalid start block value`) when resolving `PONDER_START_BLOCK_84532`, `PONDER_START_BLOCK`, `PONDER_START_BLOCK_11155111`, or `PONDER_START_BLOCK_31337` (`:46`, `:51`, `:54`, `:61`). The RPC probe throws `probe_requires_numeric_start_block` before any request (`scripts/lib/ponder-rpc-probe.ts:161–163`).
- **No per-request timeout.** `jsonRpc` in `scripts/lib/ponder-rpc-probe.ts:89–93` calls `fetch` with no `AbortSignal` or timeout. `lib/svm/solana-json-rpc.ts:24–33` likewise has none. That helper is the sole Solana JSON-RPC post for the product and ingest — callers include `lib/web3/svm-rpc.ts`, `lib/passport/simulate-passport-may.ts`, `src/svm-ingest/rpc-client.ts` (runtime `getBlock`), and `scripts/assert-svm-binary-identity.ts`. Both deploy SSH steps set `command_timeout: 30m` (`deploy-ponder.yml:89`, `deploy-svm-ingest.yml:46`). The deploy lock wait is `flock -w 900` (`deploy-ponder.yml:95`, `deploy-svm-ingest.yml:52`).
- **Commercial probe fan-out.** `commercialPonderProbeChainIds` returns two chains (`scripts/lib/ponder-rpc-probe.ts:143–145`). Each provider is probed with three JSON-RPC methods. The svm-ingest census is six followed programs (`lib/svm/ingest-config.ts:46–88`).
- **svm-ingest config.** It has no single runtime-config owner. `SOLANA_RPC_URL` and the database URL are checked inline in `src/svm-ingest/main.ts:38–46`, the port at `:77`. Today's database resolution is `SVM_INGEST_DATABASE_URL?.trim() ?? DATABASE_URL?.trim()` (`:43–44`): an empty or whitespace primary is a non-nullish string after `trim()`, so it blocks the `DATABASE_URL` fallback. `lib/svm/ingest-config.ts` refuses `SVM_INGEST_EID` (`:248`), namespace mismatch (`:261–264`), `SVM_INGEST_CATCHUP_MAX_LAG_SLOTS` (`:285`), `SVM_INGEST_MAX_RPS` (`:297`), and incomplete commercial stacks via `MissingCommercialProgramError` (`:98–109`, thrown at `:185`).
- **Where `build` and `up` sit.** In `deploy-ponder.yml`, `build` and `up` are adjacent (`:141–142`) and the fingerprint state is written after readiness (`:153`). Image prune follows (`:154`). The same `build`/`up` pair in `deploy-svm-ingest.yml` is at `:61–62`; prune at `:73`.
- **Lock, checkout, unchanged path.** Both deploy scripts acquire `.deploy.lock` with `flock -w 900`, then `git checkout --force "$DEPLOY_SHA"` (`deploy-ponder.yml:94–101`, `deploy-svm-ingest.yml:51–58`). On Ponder, when the stored executable digest matches, the script prints `outcome=unchanged` evidence and exits before `build` (`deploy-ponder.yml:113–128`).
- **Ponder config load.** `ponder.config.ts:10` imports `buildPonderRuntime`; `:46` destructures its result into the object passed to `createConfig`. That file is what Ponder executes at `stage=config`.

## Decision

Add a preflight step that refuses before `docker compose up` replaces the running container.

1. **Mechanism.** After `docker compose build <service>` and before `docker compose up`, the deploy script runs the preflight in a one-off container of the newly built image:

   ```text
   docker compose run --rm --no-deps --entrypoint node ponder --import tsx scripts/ponder-deploy-preflight.ts
   docker compose run --rm --no-deps --entrypoint node svm-ingest --import tsx scripts/svm-ingest-deploy-preflight.ts
   ```

   - Compose resolves the env exactly as `up` will.
   - The one-off container publishes no ports and does not touch the running container.
   - The preflight script comes from the image, which is built from `DEPLOY_SHA`, so there is no host mount.

2. **Ponder preflight.**
   - It evaluates `ponder.config.ts` itself, the file Ponder loads at `stage=config`. It does not make a parallel call into `buildPonderRuntime`.
   - It then runs `probeAllCommercialPonderRpcs` (`scripts/lib/ponder-rpc-probe.ts`). Every provider must return `ok`, with no retry. A provider that cannot serve the probe's three requests cannot serve the indexer. A false red costs one `workflow_dispatch` re-run while the old container keeps serving.

3. **Typed refusals and closed reason codes.** Config owners throw one typed refusal: a closed union of codes plus the env key name (where applicable). The preflight prints `reason=<code>` from that type (or from the closed non-config codes below) and never parses message text and never prints message text. Existing human messages keep their wording.

   **Ponder env** (`scripts/lib/ponder-env.ts`), including today's start-block refusal:

   | Code | Env key |
   |------|---------|
   | `invalid_start_block` | `PONDER_START_BLOCK_84532`, `PONDER_START_BLOCK`, `PONDER_START_BLOCK_11155111`, or `PONDER_START_BLOCK_31337` (the key `parseStartBlock` was resolving) |
   | `missing_getlogs_block_range` | `PONDER_GETLOGS_BLOCK_RANGE_<chainId>` |
   | `missing_rpc_urls` | `PONDER_RPC_URLS_<chainId>` |
   | `empty_rpc_urls` | `PONDER_RPC_URLS_<chainId>` |
   | `invalid_rpc_url` | `PONDER_RPC_URLS_<chainId>` |
   | `duplicate_rpc_url` | `PONDER_RPC_URLS_<chainId>` |

   **Ponder probe precondition** (thrown before any RPC request; typed the same way):

   | Code | Env key |
   |------|---------|
   | `probe_requires_numeric_start_block` | `PONDER_START_BLOCK_<chainId>` (the chain-specific start key; for Base Sepolia also the legacy `PONDER_START_BLOCK` when that supplied the value) |

   **Ponder RPC probe failure** (any provider verdict other than `ok` — not a config refusal):

   | Code | Meaning |
   |------|---------|
   | `rpc_probe_failed` | At least one provider returned a non-`ok` verdict; per-provider lines carry the verdict |

   **svm-ingest runtime** — `buildSvmIngestRuntime` in `lib/svm/ingest-config.ts` throws the same typed refusal shape:

   | Code | Env key |
   |------|---------|
   | `missing_solana_rpc_url` | `SOLANA_RPC_URL` |
   | `missing_database_url` | `SVM_INGEST_DATABASE_URL` (primary). Resolution accepts `DATABASE_URL` as fallback. An empty or whitespace value after `trim()` counts as unset for both keys, so a blank `SVM_INGEST_DATABASE_URL` does not block the fallback (unlike today's `main.ts:43–44`). The refusal names the primary key. |
   | `invalid_svm_ingest_eid` | `SVM_INGEST_EID` |
   | `svm_ingest_namespace_mismatch` | `SVM_INGEST_NAMESPACE` |
   | `invalid_catchup_max_lag_slots` | `SVM_INGEST_CATCHUP_MAX_LAG_SLOTS` |
   | `invalid_ingest_max_rps` | `SVM_INGEST_MAX_RPS` |
   | `missing_commercial_program` | not an env key — carries the missing commercial evidence key name(s) |

   **svm-ingest followed-program check** (after runtime resolves):

   | Code | Meaning |
   |------|---------|
   | `program_account_missing` | Followed program account does not exist on the configured RPC |
   | `program_not_executable` | Account exists but is not executable |
   | `program_check_unreachable` | Account fetch timed out or otherwise could not reach the RPC |

   **Any other error** (import failure, untyped throw, probe exception, and similar):

   | Code | Meaning |
   |------|---------|
   | `preflight_error` | Closed fallback for errors nobody named; the preflight prints this code only — never the error message (messages may contain URLs). Unreachable RPC is not this code. |

4. **Exact preflight output lines (no RPC addresses).** Every printed diagnostic line is one of the formats below. No URL and no error detail appear on any of them. This is a property of the preflight's output, asserted by a test. The maintainer CLI `pnpm ponder:rpc-probe` is unchanged in its human diagnostics.

   Per commercial provider (Ponder), after the probe runs:

   ```text
   deploy_preflight service=ponder chain=<chainId> provider=<index> verdict=<verdict>
   ```

   `<index>` is the provider's zero-based index in that chain's RPC list. `<verdict>` is the probe verdict (`ok`, `unreachable`, …).

   Per followed program (svm-ingest), after the account check:

   ```text
   deploy_preflight service=svm-ingest program=<evidenceKey> verdict=<ok|account_missing|not_executable|unreachable>
   ```

   On any refusal (both services), then exit non-zero:

   ```text
   deploy_preflight service=<ponder|svm-ingest> verdict=refused reason=<code>
   deploy_evidence outcome=refused
   ```

   On success, the `recreated` evidence gains:

   ```text
   deploy_evidence preflight=ok
   ```

5. **svm-ingest.**
   - One runtime-config owner, `buildSvmIngestRuntime` in `lib/svm/ingest-config.ts`, resolves everything `main.ts` needs: RPC URL, database URL, stack and namespace, start slot, lag, max RPS, and port. `main.ts` consumes only that owner, and the inline checks are deleted.
   - The svm-ingest preflight builds that runtime and checks that every followed program account exists and is executable on the configured RPC. This also proves the RPC serves the right cluster, without adding a new fact to the network registry. On failure it prints the per-program line above, then the refusal line with `reason=program_account_missing`, `reason=program_not_executable`, or `reason=program_check_unreachable`.
   - It performs no database writes; schema bootstrap stays in `main.ts`.

6. **Per-request time bound.** Every JSON-RPC request made by the Ponder probe and by the svm-ingest preflight uses a **10_000 ms** per-request timeout (`AbortSignal`).
   - **Ponder:** the timeout lives inside `scripts/lib/ponder-rpc-probe.ts` `jsonRpc`. That module is used only by the probe CLI and the preflight, so baking the bound there is fine; `pnpm ponder:rpc-probe` gets it too.
   - **Solana:** the timeout is an **explicit per-call input** of `lib/svm/solana-json-rpc.ts` `postSolanaJsonRpc` (signature change). The svm-ingest preflight passes `10_000`. Every other caller under this ADR omits the timeout and keeps today's unbounded behaviour — including `lib/web3/svm-rpc.ts`, `lib/passport/simulate-passport-may.ts`, runtime `getBlock` via `src/svm-ingest/rpc-client.ts`, and `scripts/assert-svm-binary-identity.ts`.
   - **Worst-case hold under `.deploy.lock`:** a peer deploy waits at most 900s (`flock -w 900`). SSH `command_timeout` is 30m. Without a bound, a silent RPC holds the lock until that 30m limit. With the bound, sequential worst case (every request times out):
     - Ponder: `T_ponder = 10s × 3 requests × N`, where `N` is the total number of commercial providers across both chains in `commercialPonderProbeChainIds()` (`scripts/lib/ponder-rpc-probe.ts:143–145`).
     - svm-ingest: `T_svm = 10s × P` for one account fetch per followed program, or `10s` if the check batches into one call. `P = |SVM_COMMERCIAL_PROGRAM_CENSUS|` = **6** today (`lib/svm/ingest-config.ts:46–88`), so `T_svm ≤ 60s` (or 10s if batched).
     - **`T_ponder` reaches 900s when `N = 30`** (`10 × 3 × 30 = 900`). Below that provider count the Ponder preflight alone cannot exhaust the peer's lock wait; at 30 providers it meets it; above 30 it would exceed it.
   - A timed-out Ponder probe request maps to the existing verdict `unreachable`. A timed-out svm-ingest account fetch maps to per-program verdict `unreachable` and refusal reason `program_check_unreachable`.

7. **Composition with ADR 0010.**
   - The preflight runs inside the deploy lock, after checkout and `build`, before `up`, and only on the path that recreates the container. The Ponder `unchanged` path does not run it. Readiness, the fingerprint state file, and image prune stay after a successful `up` on the recreate path (as today: `deploy-ponder.yml:148–154`, `deploy-svm-ingest.yml:68–73`).
   - On refusal the script prints the refusal lines in Decision §4, then exits non-zero before `up`. The fingerprint state file is not written, and image prune does not run.
   - On success, the `recreated` evidence includes `deploy_evidence preflight=ok`.

## One rejected alternative and why

Validate `.env` by hand before each merge. Rejected: that is what failed on 2026-10-27, and a check that relies on memory is not a gate.

## Consequences

- **Implementation PR negative controls** (red before green, from #50 Acceptance, plus the timeout control): a missing RPC list, a missing getLogs window, and a probe failure each stop the Ponder deploy before `up`. A missing `SOLANA_RPC_URL` and a non-executable followed program each stop svm-ingest before `up`. Preflight output containing a provider URL fails its test. A provider or program-account fetch that never answers yields verdict `unreachable` within the 10_000 ms bound (`program_check_unreachable` for svm-ingest).
- **Policy owner:** `test/deploy-ponder-svm-ingest-ci-policy.test.ts` is the sole suite that owns “both deploy scripts run the preflight between `build` and `up` and print the refusal and evidence lines above.” (`test/deploy-vps-secret-policy.test.ts` owns only secrets, triggers, and gates.)
- **Local Docker evidence** the implementation PR must show: the preflight is red with a missing variable and green with the planned env.
- **Out of scope, tracked elsewhere:** a `build_id` mismatch (`MigrationError`) is not a configuration refusal — that belongs to #47. The identity fingerprint is a superset of Ponder's `build_id` inputs, so it cannot decide that refusal. The reindex scripts and runbook still naming the removed singular RPC variable is #55.

## Status

Accepted. The maintainer’s merge of this ADR PR is the acceptance.
