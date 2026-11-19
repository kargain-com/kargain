# Architecture overview

Public map of services, truth, and owners. Host names, IPs, users, and server paths stay with the maintainer. Environment variables live only in [`.env.example`](../../.env.example). Normative contract behaviour is [SPEC Part I](../contracts/SPEC.md#part-i--generation-v2-current); indexing deploy rules are [ADR 0016](../adr/0016-one-writer-schema-per-indexing-identity.md).

## Services

| Surface | Responsibility |
|---------|----------------|
| **App** (Next.js) | UI, session, Server Actions; discovery via the indexer HTTP API; chain RPC for detail reads and writes |
| **Ponder** (`ponder`) | Single EVM writer and Hono HTTP API; one schema per indexing identity (`k_<40 hex>`) baked into the writer image |
| **Ponder deploy** (`ponder-deploy`) | Profile-only one-off; builds and switches the writer tag; not a long-running service |
| **Postgres** | Shared database: Ponder writer schema, `kargain_svm_raw`, SVM projection |
| **svm-ingest** | Solana raw ingest into `kargain_svm_raw`; projection is rebuilt by replay, never by dropping raw |
| **strfry** | Nostr relay (kinds the product publishes and reads) |
| **Tunnel** | Edge front for the writer HTTP port; Compose target remains `http://ponder:42069` |
| **Storage** | Arweave via Irys — client-side upload; the user wallet pays; deposit owned by `lib/storage/irys-deposit.ts` |
| **Messaging** | XMTP private sessions; product door `lib/messaging/session-registry.ts` |

Commercial addresses, SVM program ids, and start cursors come only from [`lib/web3/commercial-active.ts`](../../lib/web3/commercial-active.ts). There is no nginx front, no blue/green writer slots, and no views schema over writers ([ADR 0016](../adr/0016-one-writer-schema-per-indexing-identity.md)).

```mermaid
flowchart LR
  ui[App]
  chain[Commercial_chains]
  ponder[Ponder_writer]
  ingest[svm_ingest]
  pg[(Postgres)]
  relay[strfry]
  storage[Irys_Arweave]
  msg[XMTP]
  ui -->|writes| chain
  ui -->|tagged_reads| ponder
  chain -->|EVM_logs| ponder
  chain -->|SVM_slots| ingest
  ponder --> pg
  ingest --> pg
  ui --> relay
  ui --> storage
  ui --> msg
```

## Truth layers

1. **Chain is authority.** A user write is settled when there is a receipt (and a successful chain read when the UI needs it). Indexer catch-up is not settlement.
2. **Indexers are projections.** Browse, directories, and notifications read Ponder (and the SVM projection) as eventual views of chain history.
3. **Tagged app→indexer reads.** Mutable Ponder projections go through [`lib/web3/ponder-tagged-read.ts`](../../lib/web3/ponder-tagged-read.ts). Wait instruments (`/status`, live passport catch-up) stay uncached.
4. **One post-write refresh owner.** [`hooks/use-tx-sync.ts`](../../hooks/use-tx-sync.ts) (`syncReads`) invalidates indexer tags, client caches, and `router.refresh()`.

Trust does not survive a bridge crossing ([SPEC §I.12](../contracts/SPEC.md#i12-multi-chain-architecture-normative)). Custody: one usable copy on one network.

## Write path (UI → chain → indexer → UI)

1. Session / wallet state from [`lib/web3/active-account.ts`](../../lib/web3/active-account.ts).
2. Write planning and send through the VM write owners; lifecycle and outcomes through `useTxSync` / `runTx`.
3. Chain confirms the transaction.
4. Ponder indexes EVM logs into the writer schema; `svm-ingest` appends Solana raw and projects.
5. `syncReads` refreshes tagged indexer reads and the route; discovery UIs then show the new projection.

## Area owners

Executable registry: [`lib/architecture/chokepoints.ts`](../../lib/architecture/chokepoints.ts). Product code does not fork by VM in `app/`, `components/`, or `hooks/` — the fork lives in the owner.

| Area | Owner |
|------|--------|
| Wallet / session | `lib/web3/active-account.ts` |
| Writes and outcomes | `hooks/use-tx-sync.ts` |
| Reads | `lib/web3/keyed-multicall.ts` |
| Registry / network roles | `lib/web3/commercial-active.ts` |
| Amounts / explorer URLs | `lib/web3/native-amount.ts` · `lib/web3/network-explorer.ts` |
| Passport presence / origin | `lib/passport/presence.ts` · `lib/passport/passport-holder.ts` |
| Ponder reads | `lib/web3/ponder-tagged-read.ts` |
| SVM ingest | `svm-ingest/svm-raw-writer.ts` |
| Custody fold | `lib/custody/fold.ts` |
| Storage | `lib/storage/irys-deposit.ts` |
| Messaging | `lib/messaging/session-registry.ts` |
| Bridge | `lib/web3/bridge/bridge-config.ts` |
| Geo | `lib/geo/` |
| Nostr | `lib/nostr/app-event-store.ts` |

The product key is the commercial namespace, never `chainId` alone. Further depth: [indexer README](../indexer/README.md), [design spec](../design-spec.md), [ADRs](../adr/README.md).
