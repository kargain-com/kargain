# Solana Devnet — standing deploy runbook

Standing operating rules for upgradeable programs on Solana Devnet (S4–S9). Phase runbooks ([s4b-devnet.md](./s4b-devnet.md), [s5-devnet.md](./s5-devnet.md), [s9-0-devnet-modes.md](./s9-0-devnet-modes.md)) record timelines and program ids; **this file owns upgrade-authority policy**.

Normative hot-role split: SPEC §I.13.8 (`upgrade authority` ≠ gateway config authority).

## Upgrade authority (S4–S9)

**On-chain upgrade authority = deployer** for the whole testnet port through **S9**. Same pattern as EVM `.env` roles:

| Env | Role |
|-----|------|
| `SOLANA_DEPLOYER_PRIVATE_KEY` | Secret that pays SOL and signs deploy/init (≈ `DEPLOYER_PRIVATE_KEY`) |
| `SOLANA_UPGRADE_AUTHORITY` | **Must equal** the pubkey of that secret (S4–S9) |
| `SOLANA_FORFEIT_RECIPIENT` | Public forfeit sink (≈ `FORFEIT_RECIPIENT`) |
| `SOLANA_GATEWAY_AUTHORITY` | Empty → deployer pubkey (gateway config) |

Deploy / dry-run / prove scripts **refuse** when `SOLANA_UPGRADE_AUTHORITY` ≠ deployer pubkey. Do not invent a session-only UA keypair outside `.env`. Do not hand off to an unreachable pubkey. Do **not** invent Squads at S9 without founder signers — Squads/48h = §7.6 Phase 2.

**Forbidden:** `--skip-new-upgrade-authority-signer-check` (locks programs when the new authority cannot co-sign — X3 and Y5-frozen abandon).

**Mainnet §7.6 Phase 2:** co-signed handoff / revocation of upgrade authority (and cold gateway config) — not a testnet default. Until then, retain deployer UA.

## Deploy under deployer UA

```bash
solana program deploy <path/to/program.so> \
  --program-id <PROGRAM_ID> \
  --upgrade-authority <DEPLOYER_KEYPAIR.json> \
  --keypair <DEPLOYER_KEYPAIR.json> \
  -u "$SOLANA_RPC_URL"
solana program show <PROGRAM_ID> -u "$SOLANA_RPC_URL"
# Authority must equal deployer pubkey (= SOLANA_UPGRADE_AUTHORITY)
```

## Evidence honesty

`pnpm verify:svm-authority` — every live `programs.*.upgradeAuthority` in `deployments/svm-{eid}.json` must equal on-chain ProgramData Authority (sole owner: `scripts/lib/assert-svm-upgrade-authority.ts`). Do not keep a live `plannedFinalUpgradeAuthority` field.

## Related

- First deploy (retain deployer UA): [`svm/scripts/deploy-devnet.sh`](../../svm/scripts/deploy-devnet.sh)
- Local A→B transfer lab only: [`svm/scripts/prove-upgradeable-deploy.sh`](../../svm/scripts/prove-upgradeable-deploy.sh)
- Evidence: `deployments/svm-40168.json` (gitignored)
