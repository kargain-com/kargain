/**
 * S8-5: action surfaces name EVM-session / wrong-VM causes (design-spec §4.7).
 * Screens must not collapse requireEvmSession to a bare boolean without
 * consuming refusal copy — silent disable / empty region is forbidden.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  evmSessionRefusalCopy,
  evmSessionRefusalTitle,
  wrongVmActionCopy,
} from "../lib/web3/active-account.ts";
import {
  chainSelectorStateCopy,
  chainSelectorSwitchTargets,
} from "../lib/web3/chain-selector-state.ts";
import { txWriteRefusalMessage } from "../lib/web3/tx-write-availability.ts";
import { SVM_MESSAGING_UNAVAILABLE } from "../lib/messaging/snapshot-ui.ts";
import { FIAT_TOKEN_FEED_REQUIRED_REASON } from "../lib/commerce/openable-terms.ts";
import {
  bridgeHopIdLine,
  bridgeNextHopWrongVmCopy,
  BRIDGE_SECOND_HOP_REQUIRED,
} from "../lib/passport/bridge-surface.ts";
import { scanProductSources } from "./policy-scan-helpers.ts";

const SPEC_WRONG_VM_EVM = "Connect an Ethereum wallet to act on this network";
const SPEC_WRONG_VM_SVM = "Connect a Solana wallet to act on this network";
const SPEC_FIAT =
  "Fiat pricing needs a measured price feed, which this network does not have";
const SPEC_MESSAGING = "Private messages are not available on this account.";

const ACTION_PREFIXES = [
  "components/auction/",
  "components/marketplace/",
  "components/passport/",
  "components/commerce/",
  "components/kar-pro/",
  "components/verifier/",
  "components/messaging/",
  "components/watchlist/",
  "components/notifications/",
  "components/profile/",
  "components/shell/chain-selector.tsx",
  "app/(identity)/messages/",
] as const;

const ALLOWLIST_NO_REFUSAL_COPY = new Set([
  "components/marketplace/listing-card.tsx",
  "components/auction/auction-card.tsx",
  "components/passport/passport-detail-tabs.tsx",
  "components/passport/passport-presence-status.tsx",
  "components/kar-pro/kar-pro-hero-subtitle.tsx",
  "components/shell/evm-session-refusal.tsx",
  // Identity chrome / badges — page surfaces (notifications-client, profile-edit) name the cause.
  "components/notifications/notifications-shell.tsx",
  "components/notifications/notifications-unread-badge.tsx",
  "components/profile/profile-page.tsx",
]);

/** Surfaces that must import bridgeNextHopWrongVmCopy (product consume). */
const BRIDGE_NEXT_HOP_CONSUMERS = [
  "components/passport/passport-bridge-panel.tsx",
] as const;

/** Commerce islands that must name §4.21 presence at write sites. */
const PRESENCE_ISLANDS = [
  "components/marketplace/listing-detail-client-island.tsx",
  "components/auction/auction-detail-client-island.tsx",
] as const;

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function isActionSurface(rel: string): boolean {
  return ACTION_PREFIXES.some(
    (p) => rel === p || rel.startsWith(p) || (p.endsWith(".tsx") && rel === p),
  );
}

function consumesRefusalCopy(source: string): boolean {
  return /evmSessionRefusalCopy|wrongVmActionCopy|EvmSessionRefusal|SVM_MESSAGING_UNAVAILABLE|chainSelectorStateCopy|txWriteRefusalMessage|isSvmMessagingRefusal/.test(
    source,
  );
}

function collapsesEvmSessionToBoolean(source: string): boolean {
  return (
    /requireEvmSession\s*\(/.test(source) &&
    /(?:const|let)\s+isConnected\s*=\s*evm\.ok\b/.test(source) &&
    !consumesRefusalCopy(source)
  );
}

describe("S8-5 named unavailability owners", () => {
  it("§4.7 wrong-VM copy is exact design-spec sentences", () => {
    assert.equal(wrongVmActionCopy("evm"), SPEC_WRONG_VM_EVM);
    assert.equal(wrongVmActionCopy("svm"), SPEC_WRONG_VM_SVM);
    assert.equal(evmSessionRefusalCopy("wrong_vm"), SPEC_WRONG_VM_EVM);
    assert.equal(txWriteRefusalMessage("wrong_vm"), SPEC_WRONG_VM_EVM);
    assert.equal(chainSelectorStateCopy("wrong_vm"), SPEC_WRONG_VM_EVM);
  });

  it("disconnectedTitle never overrides wrong_vm (verification-modal class)", () => {
    const feeDisconnected =
      "Connect your wallet to pay the verification fee.";
    const inspectDisconnected =
      "Connect your wallet to pay for inspection.";
    assert.equal(
      evmSessionRefusalTitle("wrong_vm", feeDisconnected),
      SPEC_WRONG_VM_EVM,
    );
    assert.equal(
      evmSessionRefusalTitle("wrong_vm", inspectDisconnected),
      SPEC_WRONG_VM_EVM,
    );
    assert.equal(
      evmSessionRefusalTitle("disconnected", feeDisconnected),
      feeDisconnected,
    );
    assert.equal(
      evmSessionRefusalTitle("disconnected", inspectDisconnected),
      inspectDisconnected,
    );
    assert.equal(
      evmSessionRefusalTitle("disconnected"),
      evmSessionRefusalCopy("disconnected"),
    );

    // Planted defect: applying disconnected override on wrong_vm without a cause gate.
    const plantedBroken = (cause: "disconnected" | "wrong_vm", override?: string) =>
      override ?? evmSessionRefusalCopy(cause);
    assert.equal(
      plantedBroken("wrong_vm", feeDisconnected),
      feeDisconnected,
      "control: ungated override would lie to an SVM session",
    );
    assert.notEqual(
      evmSessionRefusalTitle("wrong_vm", feeDisconnected),
      feeDisconnected,
    );
  });

  it("EvmSessionRefusal chrome consumes evmSessionRefusalTitle", () => {
    const src = readFileSync(
      join(
        fileURLToPath(new URL("..", import.meta.url)),
        "components/shell/evm-session-refusal.tsx",
      ),
      "utf8",
    );
    assert.match(src, /evmSessionRefusalTitle/);
    assert.doesNotMatch(
      src,
      /cause === "disconnected" && disconnectedTitle/,
    );
  });

  it("wrong_vm never offers network switch targets", () => {
    assert.deepEqual(chainSelectorSwitchTargets(84532, "wrong_vm"), []);
    assert.deepEqual(chainSelectorSwitchTargets(null, "wrong_vm"), []);
  });

  it("§4.12 SVM messaging string is exact", () => {
    assert.equal(SVM_MESSAGING_UNAVAILABLE, SPEC_MESSAGING);
  });

  it("§4.16 quote asymmetry string is exact", () => {
    assert.equal(FIAT_TOKEN_FEED_REQUIRED_REASON, SPEC_FIAT);
  });

  it("§4.19 hop helpers are exact", () => {
    assert.equal(bridgeHopIdLine(84532, 11155111), "84532 → 11155111");
    assert.equal(
      bridgeNextHopWrongVmCopy({
        networkName: "Solana Devnet",
        wantedFamily: "svm",
      }),
      "The next hop is on Solana Devnet. Connect a Solana wallet to continue.",
    );
    assert.match(BRIDGE_SECOND_HOP_REQUIRED, /second hop/i);
  });

  it("bridge panel consumes bridgeNextHopWrongVmCopy", () => {
    for (const rel of BRIDGE_NEXT_HOP_CONSUMERS) {
      assert.match(
        readSrc(rel),
        /bridgeNextHopWrongVmCopy/,
        `${rel} must render next-hop wrong-VM copy`,
      );
    }
    const planted = `const hops = route.hops; // no next-hop wrong-VM`;
    assert.doesNotMatch(planted, /bridgeNextHopWrongVmCopy/);
  });

  it("listing-edit never invents fiat unavailability copy", () => {
    const src = readSrc("components/marketplace/listing-edit-client.tsx");
    assert.match(src, /FIAT_TOKEN_FEED_REQUIRED_REASON/);
    assert.doesNotMatch(src, /Fiat is not available for this asset/);
  });

  it("commerce islands consume usePassportPresence", () => {
    for (const rel of PRESENCE_ISLANDS) {
      const src = readSrc(rel);
      assert.match(src, /usePassportPresence/, rel);
      assert.match(src, /presenceBlocksWrites|presenceCopy/, rel);
    }
  });

  it("sell panel names session before silent !isOwner hide", () => {
    const src = readSrc("components/passport/passport-sell-panel.tsx");
    assert.match(src, /!evm\.ok/);
    assert.match(src, /EvmSessionRefusal/);
    const planted = `
      if (!isOwner) return null;
    `;
    assert.doesNotMatch(planted, /EvmSessionRefusal/);
  });
});

describe("S8-5 action-surface refusal census", () => {
  it("requireEvmSession action surfaces consume refusal copy (not bare isConnected)", () => {
    const violations = scanProductSources((rel, source) => {
      if (!isActionSurface(rel)) return false;
      if (ALLOWLIST_NO_REFUSAL_COPY.has(rel)) return false;
      if (!/requireEvmSession\s*\(/.test(source)) return false;
      if (collapsesEvmSessionToBoolean(source)) {
        return "collapses requireEvmSession to isConnected without refusal copy";
      }
      return false;
    });
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("watchlist / offers / comments / make-offer are not allowlisted silent hides", () => {
    assert.equal(
      ALLOWLIST_NO_REFUSAL_COPY.has(
        "components/marketplace/listing-make-offer-button.tsx",
      ),
      false,
    );
    assert.equal(
      ALLOWLIST_NO_REFUSAL_COPY.has(
        "components/marketplace/nostr-comments-section.tsx",
      ),
      false,
    );
    assert.match(
      readSrc("components/marketplace/listing-make-offer-button.tsx"),
      /EvmSessionRefusal/,
    );
    assert.match(
      readSrc("components/marketplace/nostr-comments-section.tsx"),
      /evmSessionRefusalCopy/,
    );
    assert.match(
      readSrc("components/watchlist/watchlist-button.tsx"),
      /EvmSessionRefusal/,
    );
  });

  it("planted collapse without refusal copy turns red", () => {
    const dirty = `
      import { requireEvmSession } from "@/hooks/use-active-account";
      const evm = requireEvmSession(account);
      const isConnected = evm.ok;
      if (!isConnected) return null;
    `;
    assert.equal(collapsesEvmSessionToBoolean(dirty), true);
    const clean = `
      import { requireEvmSession, evmSessionRefusalCopy } from "@/hooks/use-active-account";
      const evm = requireEvmSession(account);
      const isConnected = evm.ok;
      if (!evm.ok) return <p>{evmSessionRefusalCopy(evm.cause)}</p>;
    `;
    assert.equal(collapsesEvmSessionToBoolean(clean), false);
  });

  it("wrong_vm co-located Switch prompt without refusal copy is a defect class", () => {
    const dirty = `
      const isConnected = evm.ok;
      const wrongChain = !walletChainId || walletChainId !== chainId;
      if (wrongChain) return <p>Switch to the correct network to bid.</p>;
    `;
    const hasFalseSwitch =
      /Switch to the correct network/.test(dirty) &&
      /isConnected\s*=\s*evm\.ok/.test(dirty) &&
      !consumesRefusalCopy(dirty);
    assert.equal(hasFalseSwitch, true);

    const clean = `
      import { EvmSessionRefusal } from "@/components/shell/evm-session-refusal";
      const wrongChain = evm.ok && walletChainId !== chainId;
      if (!evm.ok) return <EvmSessionRefusal cause={evm.cause} />;
      if (wrongChain) return <p>Switch to the correct network to bid.</p>;
    `;
    const cleanFalse =
      /Switch to the correct network/.test(clean) &&
      /isConnected\s*=\s*evm\.ok/.test(clean) &&
      !consumesRefusalCopy(clean);
    assert.equal(cleanFalse, false);
  });

  it("NWC connect maps wrong_vm to family copy", () => {
    const src = readSrc("components/profile/nwc-connect-field.tsx");
    assert.match(src, /wrong_vm/);
    assert.match(src, /wrongVmActionCopy/);
    const planted = `case "wallet_disconnected": return "Connect your wallet first.";`;
    assert.doesNotMatch(planted, /wrongVmActionCopy/);
  });

  it("conversation page names SVM messaging refusal", () => {
    const src = readSrc(
      "app/(identity)/messages/[conversationId]/page.tsx",
    );
    assert.match(src, /SVM_MESSAGING_UNAVAILABLE/);
    assert.match(src, /isSvmMessagingRefusal/);
    assert.doesNotMatch(src, /router\.replace\("\/messages"\)/);
  });
});

describe("S8-5 chain-selector chrome", () => {
  it("selector source uses chainSelectorStateCopy for wrong_vm", () => {
    const src = readSrc("components/shell/chain-selector.tsx");
    assert.match(src, /chainSelectorStateCopy/);
    assert.doesNotMatch(
      src,
      /Wrong network — wallet family cannot switch/,
    );
  });
});
