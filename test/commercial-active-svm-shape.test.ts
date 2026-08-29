/**
 * S4a T3 — SVM commercial stack shape + fail-closed reserved namespace.
 * No live Solana row in COMMERCIAL_ACTIVE.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMERCIAL_ACTIVE,
  commercialActive,
  isCommercialChainId,
  requireCommercialActive,
  type CommercialActiveStack,
  type SvmCommercialActiveStack,
} from "../lib/web3/commercial-active.ts";
import {
  mintKargainNamespace,
  namespaceFromLayerZeroEid,
} from "../lib/web3/kargain-namespace.ts";
import { normalizeProtocolAddressForVm } from "../lib/web3/protocol-address.ts";

/** Solana Devnet LayerZero EID 40168 → reserved namespace (SPEC §13.1). */
const SOLANA_DEVNET_NAMESPACE = namespaceFromLayerZeroEid(40168);

/**
 * Type-level + runtime probe: an SVM-shaped object satisfies the commercial
 * stack union. Addresses are illustrative base58 (normalized); not a live row.
 */
const SVM_SHAPE_PROBE = {
  vm: "svm",
  namespace: mintKargainNamespace(SOLANA_DEVNET_NAMESPACE),
  nativeUnit: { symbol: "SOL", decimals: 9 },
  karPassport: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  karProPass: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  karProStaking: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  nativeFeed: "",
  timelock: "11111111111111111111111111111111",
  bridgeGateway: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  layerZeroEndpoint: "76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6",
  platformRecipient: "11111111111111111111111111111112",
  deployer: "11111111111111111111111111111113",
  upgradeAuthority: "11111111111111111111111111111114",
  indexFromBlock: 0,
  blocks: {},
} as const satisfies SvmCommercialActiveStack;

// Compile-time: SVM arm is a CommercialActiveStack member.
const _unionProbe: CommercialActiveStack = SVM_SHAPE_PROBE;
void _unionProbe;

describe("commercial-active SVM shape (S4a T3)", () => {
  it("SVM shape satisfies CommercialActiveStack and normalizes base58", () => {
    assert.equal(SVM_SHAPE_PROBE.vm, "svm");
    assert.equal(Number(SVM_SHAPE_PROBE.namespace), SOLANA_DEVNET_NAMESPACE);
    assert.equal(
      normalizeProtocolAddressForVm("svm", SVM_SHAPE_PROBE.layerZeroEndpoint),
      SVM_SHAPE_PROBE.layerZeroEndpoint,
    );
  });

  it("live registry stays EVM-only — no Solana row", () => {
    assert.equal(commercialActive(SOLANA_DEVNET_NAMESPACE), undefined);
    assert.equal(isCommercialChainId(SOLANA_DEVNET_NAMESPACE), false);
    assert.ok(!(SOLANA_DEVNET_NAMESPACE in COMMERCIAL_ACTIVE));
    for (const stack of Object.values(COMMERCIAL_ACTIVE)) {
      assert.equal(stack.vm, "evm");
    }
  });

  it("reserved namespace without a row fails closed by name", () => {
    assert.throws(
      () => requireCommercialActive(SOLANA_DEVNET_NAMESPACE),
      /no SVM row for reserved namespace 2000040168/,
    );
  });

  it("unknown non-reserved chain keeps the generic missing message", () => {
    assert.throws(
      () => requireCommercialActive(1),
      /No COMMERCIAL_ACTIVE entry for chain 1/,
    );
  });
});
