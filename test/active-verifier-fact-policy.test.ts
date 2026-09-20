/**
 * §7.2 U6.5 — dual-VM active-verifier admission fact.
 *
 * Tri-state pin: unresolved ≠ inactive. Obligation derive still receives
 * `undefined` when unresolved. Planted boolean collapse and evm.ok address
 * feed are red.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  derivePassportActionSurface,
  isAvailable,
} from "@/lib/passport/action-surface";
import {
  VERIFICATION_INSTANCE,
  deriveChallengeSurface,
} from "@/lib/challenge";
import { deriveOutstandingObligations } from "@/lib/obligation/derive";
import {
  hexToBytes,
  stakeAccountLayout,
} from "@/lib/svm/decode-account-state";
import {
  activeVerifierToBooleanOrUndefined,
  planActiveVerifierRead,
  resolveActiveVerifierFact,
  type ActiveVerifierFact,
} from "@/lib/verifier/active-verifier-fact";
import {
  commercialSvmNamespaceIds,
} from "@/lib/web3/commercial-active";
import { mintKargainNamespace } from "@/lib/web3/kargain-namespace";
import {
  vmBranchViolationInSource,
  VM_BRANCH_ALLOWLIST,
} from "./network-vm-component-policy.test.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_REL = "lib/verifier/active-verifier-fact.ts";
const PANEL_REL = "components/passport/passport-actions-panel.tsx";
const HOOK_REL = "hooks/use-active-verifier-fact.ts";

function ownerSource(): string {
  return readFileSync(path.join(ROOT, OWNER_REL), "utf8");
}

function panelSource(): string {
  return readFileSync(path.join(ROOT, PANEL_REL), "utf8");
}

function presenceHere(viewChainId = 84532) {
  return {
    viewChainId,
    custodyLock: { status: "known", locked: false } as const,
    ponderCustodyChain: viewChainId,
    custodyUnresolved: null,
  };
}

function challengeIdle(wallet: string) {
  return deriveChallengeSurface(VERIFICATION_INSTANCE, {
    challenge: null,
    wallet,
    isActiveVerifier: false,
    passportStatus: "VERIFIED",
    owner: wallet,
    recordedVerifier: "0x2222222222222222222222222222222222222222",
    opener: "",
    nowSec: 1_700_000_000,
    requireDisputedStatus: true,
  });
}

describe("activeVerifierFact tri-state", () => {
  it("maps active / inactive / unresolved to boolean | undefined", () => {
    assert.equal(
      activeVerifierToBooleanOrUndefined({ kind: "active" }),
      true,
    );
    assert.equal(
      activeVerifierToBooleanOrUndefined({ kind: "inactive" }),
      false,
    );
    assert.equal(
      activeVerifierToBooleanOrUndefined({ kind: "unresolved" }),
      undefined,
    );
  });

  it("EVM success true → active; success false → inactive; pending → unresolved", () => {
    assert.deepEqual(
      resolveActiveVerifierFact({
        entry: { status: "success", result: true },
        sessionBound: true,
        vm: "evm",
      }),
      { kind: "active" },
    );
    assert.deepEqual(
      resolveActiveVerifierFact({
        entry: { status: "success", result: false },
        sessionBound: true,
        vm: "evm",
      }),
      { kind: "inactive" },
    );
    assert.deepEqual(
      resolveActiveVerifierFact({
        entry: undefined,
        sessionBound: true,
        vm: "evm",
      }),
      { kind: "unresolved" },
    );
    assert.deepEqual(
      resolveActiveVerifierFact({
        entry: undefined,
        sessionBound: false,
        vm: "evm",
      }),
      { kind: "inactive" },
    );
  });

  it("SVM active golden → active; undecodable → inactive; pending → unresolved", () => {
    const golden = hexToBytes(stakeAccountLayout().goldenHex);
    assert.deepEqual(
      resolveActiveVerifierFact({
        entry: { status: "success", result: golden },
        sessionBound: true,
        vm: "svm",
      }),
      { kind: "active" },
    );

    const inactiveGolden = new Uint8Array(golden);
    // active is at offset 56 (8+32+8+8).
    inactiveGolden[56] = 0;
    assert.deepEqual(
      resolveActiveVerifierFact({
        entry: { status: "success", result: inactiveGolden },
        sessionBound: true,
        vm: "svm",
      }),
      { kind: "inactive" },
    );

    assert.deepEqual(
      resolveActiveVerifierFact({
        entry: {
          status: "refused",
          cause: "account_not_found",
        },
        sessionBound: true,
        vm: "svm",
      }),
      { kind: "inactive" },
    );

    assert.deepEqual(
      resolveActiveVerifierFact({
        entry: {
          status: "pending",
        },
        sessionBound: true,
        vm: "svm",
      }),
      { kind: "unresolved" },
    );

    assert.deepEqual(
      resolveActiveVerifierFact({
        entry: { status: "success", result: new Uint8Array([1, 2, 3]) },
        sessionBound: true,
        vm: "svm",
      }),
      { kind: "inactive" },
    );
  });

  it("planted boolean collapse is red; live owner returns three kinds", () => {
    const src = ownerSource();
    assert.match(src, /kind:\s*"active"/);
    assert.match(src, /kind:\s*"inactive"/);
    assert.match(src, /kind:\s*"unresolved"/);
    assert.match(src, /ActiveVerifierFact/);
    assert.doesNotMatch(
      src,
      /export function resolveActiveVerifierFact[\s\S]*?:\s*boolean\s*\{/,
    );

    // Plant: owner returns plain boolean — red.
    type Collapsed = boolean;
    const plantedCollapse = (x: ActiveVerifierFact): Collapsed =>
      x.kind === "active";
    assert.throws(() => {
      assert.equal(
        typeof plantedCollapse({ kind: "unresolved" }),
        "undefined",
        "planted boolean collapse hides unresolved",
      );
    });
    assert.equal(
      activeVerifierToBooleanOrUndefined({ kind: "unresolved" }),
      undefined,
    );
  });

  it("undefined still reaches obligation derive when unresolved", () => {
    const mapped = activeVerifierToBooleanOrUndefined({ kind: "unresolved" });
    assert.equal(mapped, undefined);

    const openChallenge = {
      id: "c1",
      chainId: 84532,
      instance: "passport" as const,
      instanceContract: "0xcccccccccccccccccccccccccccccccccccccccc",
      subjectId: "1",
      challenger: "0x0000000000000000000000000000000000000001",
      bondAmount: "0",
      windowDuration: 86_400,
      openedAt: 1_700_000_000,
      status: "open" as const,
    };

    const result = deriveOutstandingObligations(
      {
        unresolved: false,
        consignments: [],
        holds: [],
        bids: [],
        challenges: [openChallenge],
        passports: [],
        modes: [],
      },
      {
        address: "0x00000000000000000000000000000000000000aa",
        nowSec: 1_700_000_000,
        isActiveVerifier: mapped,
      },
    );
    assert.equal(result.status, "ready");
    if (result.status !== "ready") return;
    assert.equal(result.judgeEligibilityUnresolved, true);

    // Plant: coerce unresolved → false before derive — loses the flag.
    const collapsed = deriveOutstandingObligations(
      {
        unresolved: false,
        consignments: [],
        holds: [],
        bids: [],
        challenges: [openChallenge],
        passports: [],
        modes: [],
      },
      {
        address: "0x00000000000000000000000000000000000000aa",
        nowSec: 1_700_000_000,
        isActiveVerifier: false,
      },
    );
    assert.equal(collapsed.status, "ready");
    if (collapsed.status !== "ready") return;
    assert.equal(collapsed.judgeEligibilityUnresolved, false);
    assert.throws(() => {
      assert.equal(collapsed.judgeEligibilityUnresolved, true);
    });
  });
});

describe("activeVerifierFact reachability", () => {
  it("EVM plan issues isActiveVerifier when session bound; disconnected → inactive", async () => {
    const bound = await planActiveVerifierRead({
      account: {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: mintKargainNamespace(84532),
        chainId: 84532,
      },
      chainId: 84532,
    });
    assert.equal(bound.ok, true);
    if (!bound.ok) return;
    assert.equal(bound.sessionBound, true);
    assert.equal(bound.vm, "evm");
    assert.equal(bound.contracts.length, 1);
    assert.equal(
      (bound.contracts[0] as { functionName?: string }).functionName,
      "isActiveVerifier",
    );

    const unbound = await planActiveVerifierRead({
      account: { status: "disconnected" },
      chainId: 84532,
    });
    assert.equal(unbound.ok, true);
    if (!unbound.ok) return;
    assert.equal(unbound.sessionBound, false);
    assert.equal(unbound.contracts.length, 0);
  });

  it("SVM session plans stake keyed-read; EVM session on SVM target is unbound", async () => {
    const namespaces = commercialSvmNamespaceIds();
    assert.ok(namespaces.length > 0);
    const ns = namespaces[0]!;

    const svm = await planActiveVerifierRead({
      account: {
        status: "connected",
        vm: "svm",
        address: "So11111111111111111111111111111111111111112",
      },
      chainId: ns,
    });
    assert.equal(svm.ok, true);
    if (!svm.ok) return;
    assert.equal(svm.sessionBound, true);
    assert.equal(svm.vm, "svm");
    assert.equal(svm.contracts.length, 1);
    assert.equal((svm.contracts[0] as { vm?: string }).vm, "svm");

    // Planted old evm.ok-derived address: EVM session on SVM target → no read.
    const evmOnSvm = await planActiveVerifierRead({
      account: {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: mintKargainNamespace(84532),
        chainId: 84532,
      },
      chainId: ns,
    });
    assert.equal(evmOnSvm.ok, true);
    if (!evmOnSvm.ok) return;
    assert.equal(evmOnSvm.sessionBound, false);

    // Surface: active SVM fact offers attestation; planted unbound is red.
    const verifierWallet = "So11111111111111111111111111111111111111112";
    const offered = derivePassportActionSurface({
      presenceFacts: presenceHere(ns),
      challenge: challengeIdle(verifierWallet),
      wallet: verifierWallet,
      isOwner: false,
      holder: false,
      isActiveVerifier: activeVerifierToBooleanOrUndefined({ kind: "active" }),
      status: "VERIFIED",
      listingActive: false,
    });
    assert.equal(isAvailable(offered.appendAttestation), true);

    const plantedEvmOkAddress = activeVerifierToBooleanOrUndefined(
      resolveActiveVerifierFact({
        entry: undefined,
        sessionBound: false,
        vm: "svm",
      }),
    );
    assert.equal(plantedEvmOkAddress, false);
    const unavailable = derivePassportActionSurface({
      presenceFacts: presenceHere(ns),
      challenge: challengeIdle(verifierWallet),
      wallet: verifierWallet,
      isOwner: false,
      holder: false,
      isActiveVerifier: plantedEvmOkAddress,
      status: "VERIFIED",
      listingActive: false,
    });
    assert.equal(isAvailable(unavailable.appendAttestation), false);
    assert.throws(() => {
      assert.equal(isAvailable(unavailable.appendAttestation), true);
    });
  });

  it("panel consumes useActiveVerifierFact; no evm.ok address feed for the fact", () => {
    const src = panelSource();
    assert.match(src, /useActiveVerifierFact/);
    assert.doesNotMatch(
      src,
      /passport\s*&&\s*staking\s*&&\s*address/,
    );
    assert.doesNotMatch(src, /KarProStakingAbi/);
    assert.doesNotMatch(
      src,
      /functionName:\s*"isActiveVerifier"/,
    );

    // Planted old address feed — red.
    const planted =
      'const address = evm.ok ? evm.address : undefined;\n' +
      "passport && staking && address";
    assert.throws(() => {
      assert.doesNotMatch(planted, /passport\s*&&\s*staking\s*&&\s*address/);
    });
  });
});

describe("activeVerifierFact ownership", () => {
  it("owner is on VM allowlist; panel and hook are not; no if(vm) in panel", () => {
    assert.ok(
      (VM_BRANCH_ALLOWLIST as readonly string[]).includes(OWNER_REL),
    );
    assert.equal(
      (VM_BRANCH_ALLOWLIST as readonly string[]).includes(PANEL_REL),
      false,
    );
    assert.equal(
      (VM_BRANCH_ALLOWLIST as readonly string[]).includes(HOOK_REL),
      false,
    );
    assert.equal(vmBranchViolationInSource(panelSource()), false);
    assert.match(ownerSource(), /decodeStakeAccount/);
    assert.match(ownerSource(), /kar-pro-staking\/stake/);
  });
});
