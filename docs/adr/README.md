# Architecture decision records

Short, numbered, immutable records of decisions that shape the codebase.

**When required.** Before product work in any [pause class](../../AGENTS.md#pause-classes-adr-first) in `AGENTS.md`, open an ADR as its own PR and get maintainer approval first.

**Statuses.** `Proposed` · `Accepted` · `Superseded by NNNN`.

**Shape.** Context · Decision · One rejected alternative and why · Consequences · Status.

**Template.** [0000-template.md](./0000-template.md).

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0001](./0001-commercial-namespace-product-key.md) | Product key is the commercial namespace | Accepted |
| [0002](./0002-commercial-active-sole-runtime-source.md) | Commercial registry is the sole runtime source | Accepted |
| [0003](./0003-bridge-star-trust-resets.md) | Bridge is a star; trust resets on every crossing | Accepted |
| [0004](./0004-solana-full-protocol-parity.md) | Full protocol parity on Solana | Accepted |
| [0005](./0005-svm-raw-never-dropped.md) | `kargain_svm_raw` is never dropped | Accepted |
| [0006](./0006-svm-client-kit-wallet-standard.md) | SVM client is Kit + Wallet Standard | Accepted |
| [0007](./0007-eip155-chain-doors.md) | Branded `Eip155ChainId` for EVM-only doors | Accepted |
| [0008](./0008-development-model.md) | Issue, branch, PR, CI, review | Accepted |
| [0009](./0009-node-runtime-single-owner.md) | One pinned Node.js runtime | Accepted |
| [0010](./0010-serialized-pinned-deploys.md) | Serialized, SHA-pinned, self-evidencing deploys | Accepted |
| [0011](./0011-ponder-0-18-upgrade.md) | Ponder 0.18.2 upgrade | Accepted |
| [0012](./0012-deploy-preflight.md) | Deploy preflight before replacing the running container | Accepted |
| [0013](./0013-preflight-rate-limited.md) | Preflight refuses on provider evidence, not on `rate_limited` | Accepted |
| [0014](./0014-per-deployment-ponder-schema.md) | One Ponder schema per deployment, stable read surface | Superseded by [0015](./0015-per-deployment-ponder-schema-own-reads.md) |
| [0015](./0015-per-deployment-ponder-schema-own-reads.md) | Per-deployment Ponder schema, own-schema reads, no views | Superseded by [0016](./0016-one-writer-schema-per-indexing-identity.md) |
| [0016](./0016-one-writer-schema-per-indexing-identity.md) | One Ponder writer, one schema per indexing identity, automatic switch | Accepted |
