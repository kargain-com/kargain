# 0012 — Deploy preflight before replacing the running container

## Context

Measured on `ebfcfbc` with:

```bash
rg -n 'env_file:|environment:' docker-compose.yml
rg -n 'url=|detail=' scripts/ponder-rpc-probe.ts
rg -n 'throw new Error' scripts/lib/ponder-env.ts
rg -n 'flock|git checkout|docker compose build|docker compose up|STATE_FILE|image prune|deploy_evidence|unchanged' \
  .github/workflows/deploy-ponder.yml .github/workflows/deploy-svm-ingest.yml
rg -n 'SOLANA_RPC_URL|DATABASE_URL|SVM_INGEST_PORT|resolveIngest|resolveCatchup|resolveIngestMaxRps' \
  src/svm-ingest/main.ts
rg -n 'buildPonderRuntime' ponder.config.ts
nl -ba docker-compose.yml | sed -n '36,42p;80,90p'
nl -ba .github/workflows/deploy-ponder.yml | sed -n '94,128p;141,161p'
nl -ba .github/workflows/deploy-svm-ingest.yml | sed -n '51,79p'
nl -ba scripts/ponder-rpc-probe.ts | sed -n '19,24p'
nl -ba scripts/lib/ponder-env.ts | sed -n '148,218p'
nl -ba src/svm-ingest/main.ts | sed -n '38,77p'
```

On 2026-10-27 a Ponder deploy recreated the container while the server env still lacked a required commercial RPC list. The new image refused at `stage=config` (`missing_rpc_urls`), readiness timed out, and the indexer stayed down until a manual fix. A misconfiguration must stop the deploy and leave the old container running. This amends [ADR 0010](./0010-serialized-pinned-deploys.md).

- **Env resolution.** `docker-compose.yml` gives `ponder` and `svm-ingest` both `env_file: .env` (`:36`, `:80`) and an `environment:` block with interpolated defaults (`:38–42`, `:82–90`): `DATABASE_URL`, start blocks, svm-ingest EID and port. The values a container starts with are resolved by Compose, not by `.env` alone.
- **RPC addresses in logs.** `scripts/ponder-rpc-probe.ts:19–24` writes each provider URL and the error detail to stderr. Deploy logs of this public repository are public.
- **Refusal codes.** Refusals in `scripts/lib/ponder-env.ts` (`:156–213`) are plain `Error`s. The code (`missing_rpc_urls`, `missing_getlogs_block_range`, `invalid_rpc_url`, …) exists only as a prefix of the message text.
- **svm-ingest config.** It has no single runtime-config owner. `SOLANA_RPC_URL` and the database URL are checked inline in `src/svm-ingest/main.ts:38–46`, the port at `:77`, and the rest lives in `lib/svm/ingest-config.ts`.
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

3. **Typed refusals.** `scripts/lib/ponder-env.ts` throws one typed refusal: a closed union of codes plus the env key name. The preflight prints the code and key from that type and never parses message text. The existing messages keep their wording. Closed list from the codes that exist today (every throw that names an env key in `:156–213`):

   | Code | Env key |
   |------|---------|
   | `missing_getlogs_block_range` | `PONDER_GETLOGS_BLOCK_RANGE_<chainId>` |
   | `missing_rpc_urls` | `PONDER_RPC_URLS_<chainId>` |
   | `empty_rpc_urls` | `PONDER_RPC_URLS_<chainId>` |
   | `invalid_rpc_url` | `PONDER_RPC_URLS_<chainId>` |
   | `duplicate_rpc_url` | `PONDER_RPC_URLS_<chainId>` |

4. **No RPC addresses in deploy output.** The preflight prints chain id, the provider's index in the list, and the verdict only: no URL, no error detail. This is a property of the preflight's output, asserted by a test. The maintainer CLI `pnpm ponder:rpc-probe` is unchanged.

5. **svm-ingest.**
   - One runtime-config owner, `buildSvmIngestRuntime` in `lib/svm/ingest-config.ts`, resolves everything `main.ts` needs: RPC URL, database URL, stack and namespace, start slot, lag, max RPS, and port. `main.ts` consumes only that owner, and the inline checks are deleted.
   - The svm-ingest preflight builds that runtime and checks that every followed program account exists and is executable on the configured RPC. This also proves the RPC serves the right cluster, without adding a new fact to the network registry.
   - It performs no database writes; schema bootstrap stays in `main.ts`.

6. **Composition with ADR 0010.**
   - The preflight runs inside the deploy lock, after checkout and `build`, before `up`, and only on the path that recreates the container. The Ponder `unchanged` path does not run it. Readiness, the fingerprint state file, and image prune stay after a successful `up` on the recreate path (as today: `deploy-ponder.yml:148–154`, `deploy-svm-ingest.yml:68–73`).
   - On refusal the script prints, in these exact formats:

     ```text
     deploy_preflight service=<ponder|svm-ingest> verdict=refused reason=<code>
     deploy_evidence outcome=refused
     ```

     Then it exits non-zero before `up`. The fingerprint state file is not written, and image prune does not run.
   - On success, the `recreated` evidence gains one line:

     ```text
     deploy_evidence preflight=ok
     ```

## One rejected alternative and why

Validate `.env` by hand before each merge. Rejected: that is what failed on 2026-10-27, and a check that relies on memory is not a gate.

## Consequences

- **Implementation PR negative controls** (red before green, from #50 Acceptance): a missing RPC list, a missing getLogs window, and a probe failure each stop the Ponder deploy before `up`. A missing `SOLANA_RPC_URL` and a non-executable followed program each stop svm-ingest before `up`. Preflight output containing a provider URL fails its test.
- **Policy:** extend `test/deploy-ponder-svm-ingest-ci-policy.test.ts` (and the deploy policy suite that pins these workflows) so both deploy scripts run the preflight between `build` and `up`, and print the refusal and evidence lines above.
- **Local Docker evidence** the implementation PR must show: the preflight is red with a missing variable and green with the planned env.
- **Out of scope, tracked elsewhere:** a `build_id` mismatch (`MigrationError`) is not a configuration refusal — that belongs to #47. The identity fingerprint is a superset of Ponder's `build_id` inputs, so it cannot decide that refusal. The reindex scripts and runbook still naming the removed singular RPC variable is #55.

## Status

Accepted. The maintainer’s merge of this ADR PR is the acceptance.
