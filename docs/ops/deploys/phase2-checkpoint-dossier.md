# §7.6 Phase 2 checkpoint — mainnet dossier

**Status: PREPARED — NOT ACTIVATED**

This file is the maintainer dossier for clearing SPEC [§7.6 Phase 2](../../contracts/SPEC.md#76-layerzero-security-configuration-normative) before any **mainnet** bridge pathway.  
It does **not** authorize mainnet EIDs, peers, wire transactions, or production config writes.

| | |
|--|--|
| Prepared | July 21, 2026 |
| Cleared | — (open) |
| Normative | [SPEC §7.6](../../contracts/SPEC.md#76-layerzero-security-configuration-normative) |
| Quiet-period gates | SPEC [§7.6 (d)](../../contracts/SPEC.md#76-layerzero-security-configuration-normative) — (d1) default migration, (d2) library-upgrade timelock, (d3) 6+ months without new incidents |
| Recovery | [recovery-bridge.md](../recovery-bridge.md) |
| Testnet pathway | [I.9.1](../../contracts/SPEC.md#i91-active-deployment-base-sepolia-84532) / [I.9.2](../../contracts/SPEC.md#i92-active-deployment-ethereum-sepolia-11155111) |

**Explicit bans until this dossier is cleared and a maintainer signs off:**

- No mainnet EID tables or `setPeer` involving mainnet
- No testnet↔mainnet peers
- No 1-of-1 DVN configurations
- No EOA-held OApp config or gateway recovery authority on mainnet
- No ops/smoke `mintPassport` or live `pnpm smoke:bridge` on mainnet commercial KarPassport (infra proof = `bridge:wire:read-only`)

---

## Testnet reality (today)

| Role | Testnet (84532 / 11155111) | Mainnet requirement |
|------|----------------------------|---------------------|
| Gateway constructor `delegate` / OApp config owner | **Deployer EOA** (Nuclear `scripts/deploy.ts`) | **Timelock48h** |
| Gateway `owner` / `recoverLockedHome` | Same deployer EOA as delegate | **Timelock48h** (same address as delegate) |
| Required DVNs | Min **2** (Labs + Nethermind) | **3–5** independent |
| Confirmations | **5 / 5** explicit-fallback on 40245↔40161 | Re-derive for mainnet EID pair — **do not copy 5/5** |

Before any mainnet pathway: move gateway **delegate** and **owner** to Timelock48h. See [recovery-bridge.md](../recovery-bridge.md).

---

## Gate checklist (must all clear)

### (a) Confirmations — open

- [ ] Pin a fresh LayerZero metadata snapshot for the **mainnet** EID pair (`pnpm lz:snapshot` against mainnet keys)
- [ ] Re-derive confirmations from that snapshot — **do not** copy testnet 5/5
- [ ] Record chosen confirmations + snapshot `fetchedAt` / hash in this dossier when cleared

### (b) Config delegate + recovery authority — open

- [ ] Deploy / identify Timelock48h on each mainnet commercial chain
- [ ] Set OApp **delegate** / config ownership to Timelock48h (no EOA)
- [ ] Set gateway **owner** to Timelock48h so `recoverLockedHome` is Timelock-gated
- [ ] Document Timelock proposer/executor/admin and 48h delay in the clear record

### (c) DVN quorum — open

- [ ] Select **3–5** independent required DVNs for each mainnet pathway direction
- [ ] Labs MAY be one required DVN; MUST NOT be the only one
- [ ] Visually confirm addresses against LayerZero docs + committed snapshot
- [ ] `bridge:wire:read-only` equivalent on mainnet must fail closed on defaults / dead DVNs / non-reciprocal peers

### (d) Research quiet-period gates — open

From SPEC §7.6 (d):

- [ ] (d1) LayerZero **default migration** to 5/5 (or documented floor) complete
- [ ] (d2) **Timelock on library upgrades** in place (ecosystem / provider policy)
- [ ] (d3) **6+ months** without new LayerZero security incidents (maintainer judgment + dated note)

### (e) No ops smoke-mint — standing ban

From SPEC §7.6 (e):

- [ ] Mainnet cutover checklist excludes live `smoke:bridge` and any ops `mintPassport` on commercial KarPassport
- [ ] Infra proof on mainnet = `bridge:wire:read-only` (and equivalent) only
- [ ] No placeholder metadata URIs (`ar://nuclear-smoke` class) on commercial stacks
- [ ] Confirmed: home passport has no user burn — leftover home NFTs are permanent

### Monitoring — open

- [ ] LayerZero Console (or equivalent) alerting for bridge config and ownership changes
- [ ] Alert path tested before first mainnet pathway goes live

---

## Clearance record (fill when activating — not now)

| Field | Value |
|-------|-------|
| Cleared by | — |
| Date | — |
| Mainnet EID pair | — (none until activation) |
| Confirmations | — |
| Required DVNs | — |
| Timelock addresses | — |
| Snapshot ref | — |
| Notes | — |

Until this section is filled and HANDOFF marks mainnet bridge active, the product remains **testnet-scope**.
