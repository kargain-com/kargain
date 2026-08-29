# S4b — Solana Devnet deploy + pathway wire (40245↔40168)

**Status: BLOCKED AT X1** (August 29, 2026). Squads candidate does not exist on Devnet — **no** program deploy, **no** upgrade-authority transfer, **no** pathway wire.

**Hub peer (wiring target when unblocked):** Nuclear #7 Base Sepolia gateway from manifest only — `0x7324046854342587999984683c4833852FA81827` (EID 40245). Never literal in product code.

**Pinned DVN pair:** `layerzero-labs` + `p2p` (snapshot pathway `40168-40245`).

**Authority split (SPEC §I.13.8 refinement — docs land in X6):**
- Upgrade authority of `kar-passport` + `kar-gateway` → Squads
- Gateway **config** authority → deployer (testnet hot, mirrors EVM)
- Passport `forfeit_recipient` default → same Squads pubkey

**Tooling:** `./svm/scripts/verify-squads-multisig.sh` · (later) `svm-deploy` live · `bridge:wire` hub↔40168 · stand `--live-both`

---

## X1 — Squads verify (2026-08-29)

| Check | Result |
|-------|--------|
| Candidate pubkey | `BSuJ2aG3nxPyMnP2hxzkBTYc71k2R9Sf87PcnrzAXDaG` |
| RPC | `https://api.devnet.solana.com` (Agave `4.3.0-beta.2`) |
| `getAccountInfo` | **null** (AccountNotFound) |
| Mainnet-beta cross-check | **null** (same pubkey absent) |
| Owner = Squads V4 `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` | n/a |
| Deserialise Multisig (threshold + members) | n/a |

**Command:**

```bash
./svm/scripts/verify-squads-multisig.sh
# → FAIL: account not found … STOP
```

**Stop condition hit:** not a live Squads V4 multisig. Do not proceed to X2–X6 until founder supplies a Devnet multisig that this script prints `OK:` for (owner, threshold, members).

---

## Remaining (blocked)

| Step | Work |
|------|------|
| X2 | Real EndpointV2 `lz_receive_types` + clear CPI; mock stand path; `--live-both` green |
| X3 | Upgradeable Devnet deploy → immediate Squads upgrade authority → init + evidence |
| X4 | Wire 40245↔40168 only; read-only all `[skip]` |
| X5 | Live RT + pin non-EVM budget |
| X6 | SPEC §13.8 + this record COMPLETE + HANDOFF Next=S5 |
