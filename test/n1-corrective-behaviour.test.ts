/**
 * N1 corrective behavioural negatives — soft chrome, named refusals, EVM parity.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planSetPassportUri } from "@/lib/passport/set-passport-uri";
import { resolvePeerReachability } from "@/lib/messaging/can-message-peer";
import { DISCONNECTED_ACCOUNT } from "@/lib/web3/active-account";
import { resolveEvmChain } from "@/lib/web3/commercial-active";
import {
  erc20DecimalsQueryEnabled,
  evmWagmiWriteAdmitted,
  karProOnChainReadsEnabled,
  peerIdentityMembershipChainId,
  peerIdentityStakingChainId,
  wagmiChainIdOpts,
  wrongChainFromWagmi,
} from "@/lib/web3/evm-wagmi-chrome";
import { pollDstOwner } from "@/lib/web3/bridge";
import { evmWagmiChain } from "@/lib/web3/supported-chains";
import {
  readAccountKind,
  readAccountKindOnCommercialChains,
} from "@/lib/web3/wallet-account";

const SVM_NS = 2000040168;
const HUB = 84532;
const PEER = "0x1111111111111111111111111111111111111111" as `0x${string}`;

describe("n1-corrective-behaviour", () => {
  it("SVM namespace soft-disables wagmi chrome (no throw)", () => {
    assert.doesNotThrow(() => {
      const r = evmWagmiChain(SVM_NS);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.cause, "not_evm");
    });
  });

  it("EVM wagmi ids match pre-N1 write-union for hub and spoke", () => {
    const hub = evmWagmiChain(84532);
    const spoke = evmWagmiChain(11155111);
    assert.equal(hub.ok, true);
    assert.equal(spoke.ok, true);
    if (hub.ok) assert.equal(hub.chainId, 84532);
    if (spoke.ok) assert.equal(spoke.chainId, 11155111);
    const brandedHub = resolveEvmChain(84532);
    const brandedSpoke = resolveEvmChain(11155111);
    assert.equal(brandedHub.ok, true);
    assert.equal(brandedSpoke.ok, true);
    if (brandedHub.ok && hub.ok) assert.equal(hub.chainId, brandedHub.chainId);
    if (brandedSpoke.ok && spoke.ok) {
      assert.equal(spoke.chainId, brandedSpoke.chainId);
    }
  });

  it("readAccountKind refuses SVM / unresolved — never invents eoa", async () => {
    const svm = await readAccountKind(SVM_NS, PEER);
    assert.deepEqual(svm, { ok: false, cause: "not_evm" });
    const missing = await readAccountKind(999001, PEER);
    assert.deepEqual(missing, { ok: false, cause: "unresolved_namespace" });
  });

  it("messaging reachability uses unknown on kind refusal (not EOA)", async () => {
    const r = await resolvePeerReachability(PEER, { messagesEnabled: true }, SVM_NS);
    assert.equal(r.reachable, false);
    assert.equal(r.reason, "unknown");
  });

  it("write owner refuses SVM namespace without throw", async () => {
    const plan = await planSetPassportUri({
      account: DISCONNECTED_ACCOUNT,
      chainId: SVM_NS,
      tokenId: "1",
      uri: "ar://n1-corrective",
    });
    assert.equal(plan.ok, false);
    if (!plan.ok) {
      assert.ok(
        plan.cause === "wrong_vm" ||
          plan.cause === "disconnected" ||
          plan.cause === "unresolved_namespace" ||
          plan.cause === "not_in_program" ||
          plan.cause === "product_owner_owed" ||
          plan.cause === "authority_only",
        `expected named refusal, got ${plan.cause}`,
      );
    }
  });

  it("readAccountKindOnCommercialChains is Result-typed (contract or refuse)", async () => {
    const r = await readAccountKindOnCommercialChains(PEER);
    assert.ok("ok" in r);
    if (r.ok) {
      assert.ok(
        r.kind === "eoa" || r.kind === "contract" || r.kind === "eip7702",
      );
    } else {
      assert.ok(
        r.cause === "not_evm" ||
          r.cause === "unresolved_namespace" ||
          r.cause === "read_failed",
      );
    }
  });

  // —— Eleven site soft-disable seams ——

  it("settlement/create/agent-create/bid: wrongChain false + no wc on SVM", () => {
    const wagmi = evmWagmiChain(SVM_NS);
    assert.equal(wagmi.ok, false);
    assert.equal(wrongChainFromWagmi(true, HUB, wagmi), false);
    assert.equal(wrongChainFromWagmi(true, SVM_NS, wagmi), false);
    assert.equal(wagmi.ok ? true : false, false);
  });

  it("auction/listing detail: erc20 decimals enabled ANDs wagmi.ok", () => {
    const svm = evmWagmiChain(SVM_NS);
    const hub = evmWagmiChain(HUB);
    assert.equal(erc20DecimalsQueryEnabled(true, svm), false);
    assert.equal(erc20DecimalsQueryEnabled(false, hub), false);
    assert.equal(erc20DecimalsQueryEnabled(true, hub), true);
  });

  it("auction-finalize: write admitted only when wagmi.ok", () => {
    const svm = evmWagmiChain(SVM_NS);
    const hub = evmWagmiChain(HUB);
    assert.equal(evmWagmiWriteAdmitted(svm), false);
    assert.equal(evmWagmiWriteAdmitted(hub), true);
  });

  it("messaging-session: wagmiChainIdOpts empty on SVM", () => {
    assert.deepEqual(wagmiChainIdOpts(evmWagmiChain(SVM_NS)), {});
    const hub = evmWagmiChain(HUB);
    assert.equal(hub.ok, true);
    assert.deepEqual(wagmiChainIdOpts(hub), { chainId: HUB });
  });

  it("use-peer-identity: membership + staking chain seams refuse SVM", () => {
    assert.equal(peerIdentityMembershipChainId(SVM_NS), null);
    assert.equal(peerIdentityMembershipChainId(HUB), HUB);
    assert.equal(peerIdentityMembershipChainId(null), null);
    assert.equal(peerIdentityMembershipChainId(undefined), null);
    const svmWagmi = evmWagmiChain(SVM_NS);
    const hubWagmi = evmWagmiChain(HUB);
    assert.equal(peerIdentityStakingChainId(null, svmWagmi), undefined);
    assert.equal(peerIdentityStakingChainId(HUB, svmWagmi), undefined);
    assert.equal(peerIdentityStakingChainId(HUB, hubWagmi), HUB);
  });

  it("use-kar-pro-on-chain-profile: karProOnChainReadsEnabled refuses SVM", () => {
    const svm = evmWagmiChain(SVM_NS);
    const hub = evmWagmiChain(HUB);
    assert.equal(
      karProOnChainReadsEnabled({
        enabled: true,
        address: PEER,
        chainId: SVM_NS,
        proPassConfigured: true,
        stakingConfigured: true,
        wagmi: svm,
      }),
      false,
    );
    assert.equal(
      karProOnChainReadsEnabled({
        enabled: true,
        address: PEER,
        chainId: HUB,
        proPassConfigured: true,
        stakingConfigured: true,
        wagmi: hub,
      }),
      true,
    );
    assert.equal(
      karProOnChainReadsEnabled({
        enabled: false,
        address: PEER,
        chainId: HUB,
        proPassConfigured: true,
        stakingConfigured: true,
        wagmi: hub,
      }),
      false,
    );
  });

  it("use-bridge pollDstOwner refuses SVM without throw / RPC", async () => {
    const ac = new AbortController();
    const r = await pollDstOwner(1n, PEER, SVM_NS, ac.signal);
    assert.deepEqual(r, { status: "refused", cause: "not_evm" });
  });

  it("wrongChain on EVM when wallet differs from target", () => {
    const hub = evmWagmiChain(HUB);
    assert.equal(hub.ok, true);
    assert.equal(wrongChainFromWagmi(true, 11155111, hub), true);
    assert.equal(wrongChainFromWagmi(true, HUB, hub), false);
    assert.equal(wrongChainFromWagmi(false, 11155111, hub), false);
  });
});
