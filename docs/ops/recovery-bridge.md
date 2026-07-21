# Bridge liveness recovery (Approach A)

Kill-then-restore procedure when a LayerZero inbound is permanently undeliverable and a **home-origin** KarPassport is stranded locked in [`KarPassportBridgeGateway`](../../contracts/KarPassportBridgeGateway.sol).

Normative product rules: [contracts/SPEC.md §I.12.11](../contracts/SPEC.md#i12-multi-chain-architecture-normative).

## Safety property

1. **Kill first** on the destination Endpoint — the stuck message must never execute.
2. **Then restore** on the home chain via `recoverLockedHome`.

`recoverLockedHome` only releases a home token the gateway already holds. It has **no mint path**. Cross-chain non-duplication is **procedural** (step 1 before step 2), not a synchronous on-chain proof of the other chain. The Timelock48h delay gives observers time to object.

## Authority

| Role | Actor |
|------|--------|
| Endpoint `skip` / `nilify` / `burn` / `clear` | OApp **delegate** = Timelock48h |
| `recoverLockedHome` | Gateway **owner** = Timelock48h (same address as constructor `delegate`) |

**Testnet today:** Nuclear deploy sets gateway `delegate` / owner to the **deployer EOA**. That is allowed on testnet only ([SPEC §7.6](../contracts/SPEC.md#76-layerzero-security-configuration-normative) (b)). **Before mainnet:** both roles MUST move to Timelock48h — see [phase2-checkpoint-dossier.md](./deploys/phase2-checkpoint-dossier.md) (prepared, not activated).

No EOA-held config or recovery authority on mainnet (§7.6 / §I.12.9).

## Step 1 — Kill the counterpart inbound (destination chain)

Identify the stuck LayerZero v2 inbound on the **destination** EndpointV2:

| Field | Source |
|-------|--------|
| `srcEid` | Source pathway EID |
| `sender` | Source gateway as `bytes32` peer |
| `nonce` | Inbound nonce for that path |
| `payloadHash` | Hash of the undeliverable payload (when verified / needed for `burn` / `nilify`) |

As Timelock (OApp delegate), call the destination Endpoint (authorized for the gateway OApp):

| Situation | Endpoint action |
|-----------|-----------------|
| Not yet verified | `skip` |
| Verified but unexecuted | `nilify` or `burn` (per LZ MessagingChannel semantics) |
| Clear path (when applicable) | `EndpointV2.clear` |

After this call, that nonce/message **cannot** credit the destination. Record the Timelock schedule/execute txs and Endpoint args in the incident log.

## Step 2 — Restore home (home chain)

After step 1 is executed and confirmed:

```text
gateway.recoverLockedHome(tokenId, owner)
```

Effects:

- Requires `onlyOwner` (Timelock), home-origin `tokenId`, and `ownerOf(tokenId) == gateway`
- Calls `bridgeResetOnUnlock(tokenId, "")` → status UNVERIFIED, lock cleared, URI unchanged
- `transferFrom(gateway → owner)`
- Emits `RecoveredLockedHome(tokenId, to)`

Do **not** call step 2 if a usable representation already exists on another chain, or if the inbound might still execute.

## Hardhat coverage

[`test/KarPassportBridgeGateway.test.ts`](../../test/KarPassportBridgeGateway.test.ts) **#10** — stranded outbound (send without dest credit), happy restore, and revert matrix (`OwnableUnauthorizedAccount`, `NotHomeToken`, `NotLocked`, `ZeroRecipient`, post–round-trip `NotLocked`).
