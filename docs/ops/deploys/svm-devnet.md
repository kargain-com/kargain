# Solana Devnet — standing deploy runbook

Standing operating rules for upgradeable programs on Solana Devnet (S4+). Phase runbooks ([s4b-devnet.md](./s4b-devnet.md), [s5-devnet.md](./s5-devnet.md)) record timelines and program ids; **this file owns the authority cycle**.

Normative hot-role split: SPEC §I.13.8 (`upgrade authority` ≠ gateway config authority).

## Upgrade-authority cycle

A phase that will modify a deployed program **begins** by returning upgrade authority to the deployer and **ends** by returning it to `SOLANA_UPGRADE_AUTHORITY` after the phase’s proof. The S4b rule “authority goes to long-term control after proof” is the **second half** of this cycle, not the whole of it.

Never use `--skip-new-upgrade-authority-signer-check`. Never leave upgrade authority on the deployer after a completed phase proof. If the `SOLANA_UPGRADE_AUTHORITY` secret is unavailable when a begin-cycle return is required, **stop**.

Session-local keypair for the long-term authority: pass a keypair file path for the session (e.g. `--upgrade-authority-keypair`). Do **not** add a permanent secret env var to `.env.example`. Public pubkey remains `SOLANA_UPGRADE_AUTHORITY`.

### Begin phase (UA currently `SOLANA_UPGRADE_AUTHORITY`)

```bash
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <DEPLOYER_PUBKEY> \
  --upgrade-authority <UA_KEYPAIR.json> \
  -u "$SOLANA_RPC_URL"
solana program show <PROGRAM_ID> -u "$SOLANA_RPC_URL"
# Authority must equal deployer
```

### Iterate / upgrade under deployer

```bash
solana program deploy <path/to/program.so> \
  --program-id <PROGRAM_ID> \
  --upgrade-authority <DEPLOYER_KEYPAIR.json> \
  --keypair <DEPLOYER_KEYPAIR.json> \
  -u "$SOLANA_RPC_URL"
```

### End phase (after proof)

```bash
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority "$SOLANA_UPGRADE_AUTHORITY" \
  --keypair <DEPLOYER_KEYPAIR.json> \
  -u "$SOLANA_RPC_URL"
solana program show <PROGRAM_ID> -u "$SOLANA_RPC_URL"
# Authority must equal SOLANA_UPGRADE_AUTHORITY
```

Repeat end-phase handoff for every program the phase modified (e.g. passport + staking + pass).

## Related

- First deploy (retain deployer until proof): [`svm/scripts/deploy-devnet.sh`](../../svm/scripts/deploy-devnet.sh)
- Local A→B transfer proof: [`svm/scripts/prove-upgradeable-deploy.sh`](../../svm/scripts/prove-upgradeable-deploy.sh)
- Evidence: `deployments/svm-40168.json` (gitignored)
