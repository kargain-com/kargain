# 0013 — Preflight refuses on provider evidence, not on `rate_limited`

## Context

Measured on `66cdc6b` with:

```bash
rg -n 'PonderRpcProbeVerdict|ok: providers\.every|results\.every|rpc_probe_failed|Exit 0 only when every provider' \
  scripts/lib/ponder-rpc-probe.ts scripts/ponder-deploy-preflight.ts scripts/ponder-rpc-probe.ts
rg -n 'Every provider must return|rpc_probe_failed|any provider verdict other than' docs/adr/0012-deploy-preflight.md
rg -n 'Every provider in a list must pass|ponder:rpc-probe' docs/indexer/OPERATIONS.md
nl -ba scripts/lib/ponder-rpc-probe.ts | sed -n '17,26p;284p'
nl -ba scripts/ponder-deploy-preflight.ts | sed -n '48,51p'
nl -ba scripts/ponder-rpc-probe.ts | sed -n '1,4p;25,28p'
nl -ba docs/adr/0012-deploy-preflight.md | sed -n '61,64p;84,88p'
nl -ba docs/indexer/OPERATIONS.md | sed -n '138,140p'
```

[ADR 0012](./0012-deploy-preflight.md) §2 refuses a Ponder deploy unless every provider returns `ok`. The preflight runs on the same host, from the same IP, as the live indexer, and the live indexer already exhausts the provider's rate budget. So `rate_limited` in the preflight measures our own load, not the provider. Under that rule almost every recreate of Ponder would refuse, and whether a deploy succeeds becomes chance. Deploy is a pause class, so this ADR amends ADR 0012 §2. ADR 0012 itself is not edited.

- **The rule today.** ADR 0012 §2 (`docs/adr/0012-deploy-preflight.md:63`): "Every provider must return `ok`, with no retry. A provider that cannot serve the probe's three requests cannot serve the indexer." The second sentence is the justification, and it does not hold when the indexer is the one consuming the budget. The closed code table at `:84–88` still defines `rpc_probe_failed` as any provider verdict other than `ok`.
- **Code on `66cdc6b`.**
  - `scripts/ponder-deploy-preflight.ts:48–50` refuses with `rpc_probe_failed` unless `results.every((r) => r.ok)`.
  - `scripts/lib/ponder-rpc-probe.ts:284` sets `ok` only when every provider's verdict is `ok`.
  - The verdict union is at `scripts/lib/ponder-rpc-probe.ts:17–26` (nine values).
  - The maintainer CLI exits 0 only when every provider returns `ok` (`scripts/ponder-rpc-probe.ts:3`, `:25–28`).
- **Measured by the maintainer on the server, 2026-10-28.**
  - The probe in the production image (`docker compose run --rm --no-deps ponder pnpm ponder:rpc-probe`) returned `rate_limited` for the only Base Sepolia (84532) provider, and `ok` for the Ethereum Sepolia provider.
  - At the same time, the live Ponder logged 1984 lines matching `429|rate limit` in 30 minutes (`docker compose logs --since 30m ponder | grep -ciE '429|rate limit'`).
- **Ponder and 429.** A 429 response does not stop Ponder from starting: it retries the request. A new container faces the same budget as the one it replaces, so letting it start on `rate_limited` is no regression.
- **Where provider configuration changes.** The provider configuration (URL list, getLogs window, start block) changes only with a server `.env` edit. That event already has its own verification step: "Every provider in a list must pass `pnpm ponder:rpc-probe` at the configured window before the `.env` change" (`docs/indexer/OPERATIONS.md:140`). A new provider is outside the live indexer's budget, so that probe is not contended. A deploy changes code, not provider configuration.
- **Retry with backoff** in the probe was also considered. The competitor for the budget is our own running indexer. Retries lengthen the time spent under `.deploy.lock` and still succeed by chance.

## Decision

This ADR replaces these two sentences of [ADR 0012](./0012-deploy-preflight.md) §2 (`docs/adr/0012-deploy-preflight.md:63`):

> Every provider must return `ok`, with no retry. A provider that cannot serve the probe's three requests cannot serve the indexer.

1. **Refuse on evidence, not on missing evidence.** The deploy refuses only on verdicts that are evidence the configured provider is wrong or unusable. `rate_limited` means unverified, not wrong. The preflight prints its line and does not refuse on it. This holds even when every provider of a chain is `rate_limited`; that chain's provider lines show it.

   | `PonderRpcProbeVerdict` | Deploy refusal |
   |-------------------------|----------------|
   | `ok` | does not refuse |
   | `rate_limited` | does not refuse |
   | `chain_mismatch` | refuses |
   | `history_pruned` | refuses |
   | `window_rejected` | refuses |
   | `log_set_mismatch` | refuses |
   | `empty_reference` | refuses |
   | `unreachable` | refuses |
   | `rpc_error` | refuses |

2. **One owner of the classification.** `scripts/lib/ponder-rpc-probe.ts` exports one total classification of `PonderRpcProbeVerdict` into "refuses deploy" and "does not refuse". It is written as an exhaustive `switch` with a `never` check, so a new verdict cannot be added without classifying it. The preflight uses only that classification. The refusal reason stays `rpc_probe_failed`. Per-provider lines are unchanged.

3. **The maintainer CLI stays strict.** `pnpm ponder:rpc-probe` keeps exit 0 only when every provider is `ok`. It is the verification step for a `.env` change, where a new provider must be proven, not merely not disproven.

## One rejected alternative and why

Record a verified-configuration digest on the server, and accept `rate_limited` only for a configuration verified before. Rejected: it adds server state that has to be written from a one-off container; it refuses until a lucky `ok`, which today means never for the current provider; and it is a cached measurement that goes stale silently when a provider later prunes history. Verification belongs to the event that changes the configuration, the `.env` edit (Context, last items).

## Consequences

- **Implementation PR constructed controls** (red before green): every provider `rate_limited` → exit 0, with each `verdict=rate_limited` line printed; each of the seven refusing verdicts → `reason=rpc_probe_failed`; one `rate_limited` and one `window_rejected` in the same run → refused. The maintainer CLI still exits 1 on `rate_limited`. `pnpm test:verify` and CI `gates` green on the implementation PR head.
- **Local Docker evidence** the implementation PR must show: a local Docker run of the preflight with a fake RPC answering 429 → exit 0, with the line printed.

## Status

Accepted. The maintainer’s merge of this ADR PR is the acceptance.
