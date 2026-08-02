# Multichain browser / ops E2E checklist (testnet)

Maintainer checklist for hub↔spoke commerce on **Base Sepolia (84532)** ↔ **Ethereum Sepolia (11155111)**.  
**Does not** extend `./scripts/e2e-local.sh` (that shell stays single-chain **31337** commerce + Ponder).

Canonical policy: [SPEC §I.12](../../contracts/SPEC.md#i12-multi-chain-architecture-normative) · [§7.6](../../contracts/SPEC.md#76-layerzero-security-configuration-normative) · addresses [I.9.1](../../contracts/SPEC.md#i91-active-deployment-base-sepolia-84532) / [I.9.2](../../contracts/SPEC.md#i92-active-deployment-ethereum-sepolia-11155111).

---

## Why not dual-node `e2e-local`

| Layer | Covers hub↔spoke? |
|-------|-------------------|
| `test/KarPassportBridgeGateway.test.ts` (`gatewayHub` / `gatewaySpoke`) | Yes — lock/mint/return, guards, recovery |
| `pnpm smoke:bridge` + SPEC I.9 / [nuclear-4.md](./nuclear-4.md) | Yes — live testnet pathway |
| `./scripts/e2e-local.sh` / `pnpm test:e2e` | No — 31337 mint/verify/list/buy + auction + optional Ponder |

A second Hardhat node + mock LZ relay + dual-chain Ponder inside `e2e-local` would mostly duplicate the gateway suite. Keep local E2E as commerce/indexer; use this checklist for browser + live ops.

---

## Prerequisites

- [ ] Nuclear stacks live on both commercial chains (`COMMERCIAL_ACTIVE`)
- [ ] Pathway wired; `pnpm bridge:wire:read-only` exit 0
- [ ] Ponder indexes both chains (`custodyChain` / omnichain)
- [ ] Wallet funded on 84532 and 11155111; app build current

---

## Automated gates (before browser)

1. [ ] `pnpm hardhat test` — include `KarPassportBridgeGateway` dual-network suite green
2. [ ] `pnpm bridge:wire:read-only` — peers reciprocal; no default libs; DVN quorum ≥2
3. [ ] `pnpm smoke:bridge` — delivery both directions (see live runbook)

---

## Browser checklist (manual)

### Bridge + custody commerce

1. [ ] Mint passport on hub (84532); status UNVERIFIED → verify if needed for product path under test
2. [ ] Bridge hub → spoke; wait for delivery (spoke ownership / indexer `custodyChain`)
3. [ ] Passport detail shows custody on spoke; commerce actions target custody chain
4. [ ] Profile passport list shows **on \<network\>** when bridged away from origin
5. [ ] Bridge return spoke → hub; home unlock resets to UNVERIFIED per §I.12; commerce back on hub

### KarPro badge union

1. [ ] Stake / join KarPro on **84532 only** → public profile shows KarPro badge
2. [ ] Stake / join KarPro on **11155111 only** → public profile shows KarPro badge (commercial OR)
3. [ ] Become KarPro CTA follows **wallet commercial target** (not hub hardcode)

### Non-goals (this checklist)

- No second Hardhat node in `e2e-local.sh`
- No Playwright automation in this iteration
- No mainnet EIDs / peers (§7.6 Phase 2 dossier must clear first)

---

## Related

- Phase 2 mainnet dossier (prepared, not active): [phase2-checkpoint-dossier.md](./phase2-checkpoint-dossier.md)
- Recovery (Timelock on mainnet): [../recovery-bridge.md](../recovery-bridge.md)
