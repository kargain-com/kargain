# S4b — Solana Devnet deploy + pathway wire (40245↔40168)

**Status: SUPERSEDED for live wire** (August 30, 2026). Y5 RT was proven on rebuild ids, then the same skip-signer handoff locked passport/gateway again (see **Abandoned Y5-frozen rebuild**). S5-recover R5 redeploys new passport+gateway under deployer UA and re-closes the pathway. Historical pathway hash / pin numbers below remain valid provenance for the abandoned generation. No Solana `COMMERCIAL_ACTIVE` row. App still serves Nuclear #4.

**Standing UA policy:** [svm-devnet.md](./svm-devnet.md) — S4–S8 deployer retains upgrade authority; no skip-signer; `pnpm verify:svm-authority`.

**Hub gateway (N7, not commercial):** `0x7324046854342587999984683c4833852FA81827` (EID 40245).

**Pinned DVN pair:** `layerzero-labs` + `p2p`.

**Live 40161↔40245 hash H2 unchanged:** `0x7e8c7fd4c6fbc0687a14335bfaae5d6fd4ecac1ea067ec955a6444e5893983b8`.

**40168↔40245 `pathwayConfigHash` (Y5-frozen generation — historical):** `0x5d4b11319bdf996b2c09b17ada09abfd2c2c2b8c413a133368338b3f5f0c9c82` (was `0x3e56db95276da719f689e451f479939829a7f723e980330e699d03c670d2ecbe`). Changed because hub enforced receive budget was rewired to the derived pin (139_638 CU / 10_784_520 lamports) and the applied-config hash now includes those pins (not EVM 100k/250k floors). **Not** the live spoke after R5 redeploy.

**Spoke OApp peer (hub setPeer) — Y5-frozen:** gateway_config PDA `J8h6ErcR6b2xqTNQ8GLJwEKfy9aodys8SC11EuBPkC1b` (not program id). Superseded when R5 wires the new gateway_config PDA.

---

## Abandoned X3 generation (do not use)

**Date abandoned:** 2026-08-29.  
**Reason:** upgrade authority was handed to hot pubkey `BSuJ2aG3nxPyMnP2hxzkBTYc71k2R9Sf87PcnrzAXDaG` **before** destination proof, via `--skip-new-upgrade-authority-signer-check`. Founder does not hold that secret → programs **locked**; rebuild with new program ids was required. These ids are **not** a second live stack.

| Program | Program id (abandoned) |
|---------|------------------------|
| kar_passport | `x8wSxkx5tW5yV9j7Lg8To5m34cj6Ji8aZ1GdKjHETrf` |
| kar_gateway | `ELNhPxSsCh2fdfndMNAjCtdmKDhcCsSezXzdgARNwWre` |
| mock_staking | `H4S6Gw1taHY5ux4adNavi4Rwi5vn9s7vEKNA4K3d6n89` |

---

## Abandoned Y5-frozen rebuild (do not use for S5)

**Date abandoned:** 2026-08-30 (S5-recover-R3).  
**Reason:** after Y5 RT, upgrade authority for passport + gateway was handed to the same unreachable `BSuJ…` via `--skip-new-upgrade-authority-signer-check`. On-chain Authority = `BSuJ…`; `solana account BSuJ…` → `AccountNotFound`. Same lock class as X3. **Not** for S5 prove / BPF upgrade / wire. S5-recover R5 redeploys new program ids with **deployer** UA (no handoff).

| Program | Program id (frozen / abandoned) | On-chain Authority |
|---------|----------------------------------|--------------------|
| kar_passport | `FsDmjkrStitUPbh46y8JocGozNotF3EcT9rpDM1RDx1i` | `BSuJ2aG3nxPyMnP2hxzkBTYc71k2R9Sf87PcnrzAXDaG` |
| kar_gateway | `EZNVaX7Xn4TER4uVxZpx8Xj87pdfTsXucMHtPJPEGbgr` | `BSuJ2aG3nxPyMnP2hxzkBTYc71k2R9Sf87PcnrzAXDaG` |

`mock_staking` `9YCgDdCkasCzziNonKJMimKJxL3fdc8s4w8HZSpLAm2s` retains deployer UA (aux; not frozen).

---

## Authority timeline

| When | Event | Why |
|------|--------|-----|
| 2026-08-29 (X3) | Deploy → handoff UA to hot `BSuJ…` via `--skip-new-upgrade-authority-signer-check` | Too early; founder does not hold that secret → programs **locked** |
| 2026-08-29 (Y1) | Hub `setPeer(40168, 0)` | Close strand trap |
| 2026-08-29 (rebuild) | **New program ids**; **deployer retains** upgrade authority | Controllable iteration; abandon X3 ids |
| 2026-08-30 (Y4) | RegisterOApp + SetPeer(40245) + production `lz_receive_types`; gateway upgrade (CPI layout) | Destination ready; hub still peer-zero |
| 2026-08-30 (Y5) | Production send CPI; hub wire; live RT both ways; pin `lz-receive-gas`; UA → `BSuJ…` (after RT) | RT proven; then UA lock (same class as X3) |
| 2026-08-30 (S4b-pin) | Hub `setEnforcedOptions` → 139_638 / 10_784_520; applied hash includes Solana pins | Close code↔chain dual floor |
| 2026-08-30 (S5-recover-R3) | Abandon `FsDmjkr…` / `EZNVaX7X…` | Skip-signer + unreachable UA; redeploy in R5 |

---

## Rebuild programs (Y5-frozen — superseded)

Evidence: `deployments/svm-40168.json` (gitignored). **Do not treat as live wire targets after R3.**

| Program | Program id | Upgrade authority |
|---------|------------|-------------------|
| kar_passport | `FsDmjkrStitUPbh46y8JocGozNotF3EcT9rpDM1RDx1i` | `BSuJ2aG3nxPyMnP2hxzkBTYc71k2R9Sf87PcnrzAXDaG` (**FROZEN**) |
| kar_gateway | `EZNVaX7Xn4TER4uVxZpx8Xj87pdfTsXucMHtPJPEGbgr` | `BSuJ2aG3nxPyMnP2hxzkBTYc71k2R9Sf87PcnrzAXDaG` (**FROZEN**) |
| mock_staking (aux) | `9YCgDdCkasCzziNonKJMimKJxL3fdc8s4w8HZSpLAm2s` | deployer (aux) |

**Config PDAs (Y5-frozen):** passport `EVsAdRnPHvRr4Bic6VcwYc8XgbsjX15WushzGWnQhNRi` · gateway `J8h6ErcR6b2xqTNQ8GLJwEKfy9aodys8SC11EuBPkC1b` · LzReceiveTypes `AGYytm4vUgD7xwFZ9tZfhSwSVhukcL8XsihsoRrxKTWh`

### Y5 proven (historical on frozen ids)

- Production EndpointV2 **send CPI** (mock path keeps `set_return_data`; stand `--live-both` green)
- Pathway init: send/receive library + nonce + ULN OApp config (labs+p2p); EXECUTOR = **ExecutorConfig PDA**
- Hub wire 40245→40168 (all `[skip]` on read-only); H2 for 40161 unchanged
- Live RT: mint N7 with `ar://s4b-y5-rt-2026-08-30-n7-devnet` → Solana foreign mint → Solana→hub unlock to deployer; URI carried; status UNVERIFIED
- Receive budget pin (provenance): compute **69_819 → ×2.0 → 139_638** CU; rent-exempt **7_189_680 → ×1.5 → 10_784_520** lamports — [`lz-receive-gas.ts`](../../../lib/web3/bridge/lz-receive-gas.ts); row in [`svm/lab/RESULTS.md`](../../../svm/lab/RESULTS.md). Send ≈280_078 CU is **not** the receive pin. **On-chain hub enforcedOptions match the pin** (S4b-pin rewire; was 200_000 / 12_000_000).
- ALT: Y5 tooling uses ephemeral per-send tables (authority = deployer). Product must not depend on a durable hot-key ALT (SPEC §13.4).

**Tooling:** `pnpm deploy:svm` · `pnpm svm:pathway-init` · `pnpm svm:y5-rt` · `bridge:wire:solana*` · `pnpm verify:svm-authority` · stand `--live-both`

---

## Prior steps (historical)

- X2 EndpointV2 receive types — mock 13 / production clear path — PASS
- X3 first deploy — abandoned (UA trap) — see **Abandoned X3 generation**
- X4 hub wire — superseded by Y1 unset
- Y1 hazard closed — peer zero
- Rebuild deploy — PASS (retain deployer UA until Y5)
- Y4 destination prove — PASS
- Y5 RT + skip-signer handoff — RT PASS; UA **locked** — see **Abandoned Y5-frozen rebuild**
