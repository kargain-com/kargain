/**
 * Tests-only SVM commercial stack (S8-1).
 * Never import from app/components/hooks/lib product paths — product resolves
 * stacks only via COMMERCIAL_ACTIVE.
 */
import type { SvmCommercialActiveStack } from "@/lib/web3/commercial-active";
import {
  mintKargainNamespace,
  namespaceFromLayerZeroEid,
} from "@/lib/web3/kargain-namespace";

/** Solana Devnet LayerZero EID 40168 → reserved namespace (SPEC §13.1). */
export const FIXTURE_SVM_NAMESPACE = namespaceFromLayerZeroEid(40168);

/** Icon URL used only by network-icon tests — not registered in product map. */
export const FIXTURE_SVM_ICON_URL =
  "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png";

/**
 * Full SVM-shaped commercial stack for owner proofs.
 * Addresses are illustrative base58; not a live Devnet row.
 */
export const FIXTURE_SVM_STACK = {
  vm: "svm",
  namespace: mintKargainNamespace(FIXTURE_SVM_NAMESPACE),
  nativeUnit: { symbol: "SOL", decimals: 9 },
  explorerBaseUrl: "https://explorer.solana.com",
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
