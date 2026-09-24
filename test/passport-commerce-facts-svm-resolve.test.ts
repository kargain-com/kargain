/**
 * S8-D1 9.3b — SVM commerce facts resolve from decoded accounts (in-memory).
 * No RPC. Known / pending / refused / absent for each fact class.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ASC_CONSIGNMENT_KEY,
  ASC_MANDATE_KEY,
  CHALLENGE_ACCOUNT_KEY,
  FP_CONSIGNMENT_KEY,
  FP_MANDATE_KEY,
  PASSPORT_CONFIG_KEY,
  PASSPORT_STATE_KEY,
  planPassportCommerceReads,
  resolvePassportCommerceFacts,
  type PassportCommerceReadPlan,
} from "../lib/passport/passport-commerce-facts.ts";
import {
  challengeAccountLayout,
  consignmentRecordLayout,
  hexToBytes,
  mandateRecordLayout,
  passportConfigLayout,
} from "../lib/svm/decode-account-state.ts";
import type { KeyedEntry, KeyedReadCause } from "../lib/web3/keyed-multicall.ts";

const SVM_NS = 2000040168;

type SvmOkPlan = Extract<PassportCommerceReadPlan, { ok: true; vm: "svm" }>;

function success(data: Uint8Array): KeyedEntry {
  return { status: "success", result: data };
}

function refused(cause: KeyedReadCause): KeyedEntry {
  return { status: "refused", cause };
}

function entryMap(
  map: Record<string, KeyedEntry | undefined>,
): (key: string) => KeyedEntry | undefined {
  return (key) => map[key];
}

function sortedUnique(keys: readonly string[]): string[] {
  return [...new Set(keys)].sort();
}

/** Run resolve and record every key `entry` is asked for. */
function observeResolveEntryKeys(plan: SvmOkPlan): {
  planKeys: string[];
  recorded: string[];
} {
  const asked: string[] = [];
  resolvePassportCommerceFacts({
    plan,
    planning: false,
    entry: (key) => {
      asked.push(key);
      return { status: "pending" };
    },
    get: () => undefined,
    isPending: false,
    namespace: plan.namespace,
  });
  return {
    planKeys: sortedUnique(plan.contracts.map((c) => c.key)),
    recorded: sortedUnique(asked),
  };
}

async function svmPlan(
  tokenId = "1",
): Promise<SvmOkPlan> {
  const plan = await planPassportCommerceReads({
    chainId: SVM_NS,
    tokenId,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok || plan.vm !== "svm") {
    assert.fail("expected SVM plan");
  }
  return plan;
}

describe("S8-D1 9.3b SVM commerce facts", () => {
  it("live plan keys ≡ keys resolve asks entry for", async () => {
    const plan = await svmPlan();
    const { planKeys, recorded } = observeResolveEntryKeys(plan);
    assert.deepEqual(
      planKeys,
      [
        ASC_CONSIGNMENT_KEY,
        ASC_MANDATE_KEY,
        CHALLENGE_ACCOUNT_KEY,
        FP_CONSIGNMENT_KEY,
        FP_MANDATE_KEY,
        PASSPORT_CONFIG_KEY,
        PASSPORT_STATE_KEY,
      ].sort(),
    );
    assert.deepEqual(recorded, planKeys);
  });

  it("plant: plan key nothing reads is red; live is green", async () => {
    const live = await svmPlan();
    const planted: SvmOkPlan = {
      ...live,
      contracts: [
        ...live.contracts,
        {
          key: "fp.recall",
          vm: "svm",
          account: "PlantedRecallAccount111111111111111111111",
        },
      ],
    };
    const plantObs = observeResolveEntryKeys(planted);
    assert.ok(
      plantObs.planKeys.includes("fp.recall"),
      "plant must enlarge the plan",
    );
    assert.ok(
      !plantObs.recorded.includes("fp.recall"),
      "resolve must not ask for the planted key",
    );
    assert.notDeepEqual(plantObs.recorded, plantObs.planKeys);

    const liveObs = observeResolveEntryKeys(live);
    assert.deepEqual(liveObs.recorded, liveObs.planKeys);
  });

  it("plant: resolve reads a key the plan omitted is red; live is green", async () => {
    const live = await svmPlan();
    const stripped: SvmOkPlan = {
      ...live,
      ascendingConfigured: true,
      contracts: live.contracts.filter(
        (c) => c.key !== ASC_CONSIGNMENT_KEY && c.key !== ASC_MANDATE_KEY,
      ),
    };
    const plantObs = observeResolveEntryKeys(stripped);
    assert.ok(
      plantObs.recorded.includes(ASC_CONSIGNMENT_KEY),
      "configured ascending still asks consignment",
    );
    assert.ok(
      plantObs.recorded.includes(ASC_MANDATE_KEY),
      "configured ascending still asks mandate",
    );
    assert.ok(
      !plantObs.planKeys.includes(ASC_CONSIGNMENT_KEY),
      "plant strips ascending accounts from the plan",
    );
    assert.notDeepEqual(plantObs.recorded, plantObs.planKeys);

    const liveObs = observeResolveEntryKeys(live);
    assert.deepEqual(liveObs.recorded, liveObs.planKeys);
  });

  it("phase known live from Offered consignment golden", async () => {
    const plan = await svmPlan();
    const golden = hexToBytes(consignmentRecordLayout().goldenHex);
    const facts = resolvePassportCommerceFacts({
      plan,
      planning: false,
      entry: entryMap({
        [FP_CONSIGNMENT_KEY]: success(golden),
        [ASC_CONSIGNMENT_KEY]: refused("account_not_found"),
        [FP_MANDATE_KEY]: refused("account_not_found"),
        [ASC_MANDATE_KEY]: refused("account_not_found"),
        [CHALLENGE_ACCOUNT_KEY]: refused("account_not_found"),
        [PASSPORT_CONFIG_KEY]: success(
          hexToBytes(passportConfigLayout().goldenHex),
        ),
        [PASSPORT_STATE_KEY]: { status: "pending" },
      }),
      get: () => undefined,
      isPending: false,
      namespace: SVM_NS,
    });
    assert.deepEqual(facts.fixedPrice.live, { status: "known", value: true });
    assert.deepEqual(facts.ascending.live, { status: "known", value: false });
    assert.deepEqual(facts.hasLiveConsignment, {
      status: "known",
      value: true,
    });
    assert.deepEqual(facts.liveConsignmentMode, {
      status: "known",
      value: "fixedPrice",
    });
  });

  it("phase known not-live when phase byte patched to None", async () => {
    const plan = await svmPlan();
    const golden = hexToBytes(consignmentRecordLayout().goldenHex);
    const none = new Uint8Array(golden);
    none[none.length - 3] = 0;
    const facts = resolvePassportCommerceFacts({
      plan,
      planning: false,
      entry: entryMap({
        [FP_CONSIGNMENT_KEY]: success(none),
        [ASC_CONSIGNMENT_KEY]: refused("account_not_found"),
        [FP_MANDATE_KEY]: refused("account_not_found"),
        [ASC_MANDATE_KEY]: refused("account_not_found"),
        [CHALLENGE_ACCOUNT_KEY]: refused("account_not_found"),
        [PASSPORT_CONFIG_KEY]: success(
          hexToBytes(passportConfigLayout().goldenHex),
        ),
      }),
      get: () => undefined,
      isPending: false,
      namespace: SVM_NS,
    });
    assert.deepEqual(facts.fixedPrice.live, { status: "known", value: false });
    assert.deepEqual(facts.hasLiveConsignment, {
      status: "known",
      value: false,
    });
  });

  it("phase pending while consignment entry pending; refused never becomes false", async () => {
    const plan = await svmPlan();
    const pendingFacts = resolvePassportCommerceFacts({
      plan,
      planning: false,
      entry: entryMap({
        [FP_CONSIGNMENT_KEY]: { status: "pending" },
        [ASC_CONSIGNMENT_KEY]: refused("account_not_found"),
      }),
      get: () => undefined,
      isPending: false,
      namespace: SVM_NS,
    });
    assert.deepEqual(pendingFacts.fixedPrice.live, { status: "pending" });

    const refusedFacts = resolvePassportCommerceFacts({
      plan,
      planning: false,
      entry: entryMap({
        [FP_CONSIGNMENT_KEY]: refused("rpc_unavailable"),
        [ASC_CONSIGNMENT_KEY]: refused("account_not_found"),
      }),
      get: () => undefined,
      isPending: false,
      namespace: SVM_NS,
    });
    assert.deepEqual(refusedFacts.fixedPrice.live, {
      status: "refused",
      cause: "rpc_unavailable",
    });
  });

  it("consignment absent → live known false", async () => {
    const plan = await svmPlan();
    const facts = resolvePassportCommerceFacts({
      plan,
      planning: false,
      entry: entryMap({
        [FP_CONSIGNMENT_KEY]: refused("account_not_found"),
        [ASC_CONSIGNMENT_KEY]: refused("account_not_found"),
      }),
      get: () => undefined,
      isPending: false,
      namespace: SVM_NS,
    });
    assert.deepEqual(facts.fixedPrice.live, { status: "known", value: false });
    assert.deepEqual(facts.ascending.live, { status: "known", value: false });
  });

  it("mandate known from golden; absent → known null", async () => {
    const plan = await svmPlan();
    const golden = hexToBytes(mandateRecordLayout().goldenHex);
    const known = resolvePassportCommerceFacts({
      plan,
      planning: false,
      entry: entryMap({
        [FP_MANDATE_KEY]: success(golden),
        [ASC_MANDATE_KEY]: refused("account_not_found"),
        [FP_CONSIGNMENT_KEY]: refused("account_not_found"),
        [ASC_CONSIGNMENT_KEY]: refused("account_not_found"),
        [CHALLENGE_ACCOUNT_KEY]: refused("account_not_found"),
        [PASSPORT_CONFIG_KEY]: success(
          hexToBytes(passportConfigLayout().goldenHex),
        ),
      }),
      get: () => undefined,
      isPending: false,
      namespace: SVM_NS,
    });
    assert.equal(known.fixedPrice.mandate.status, "known");
    if (known.fixedPrice.mandate.status === "known") {
      assert.equal(known.fixedPrice.mandate.value?.active, true);
      assert.equal(known.fixedPrice.mandate.value?.namespace, SVM_NS);
    }
    assert.deepEqual(known.ascending.mandate, {
      status: "known",
      value: null,
    });
  });

  it("mandate pending / refused preserve status", async () => {
    const plan = await svmPlan();
    const pending = resolvePassportCommerceFacts({
      plan,
      planning: false,
      entry: entryMap({ [FP_MANDATE_KEY]: { status: "pending" } }),
      get: () => undefined,
      isPending: false,
      namespace: SVM_NS,
    });
    assert.deepEqual(pending.fixedPrice.mandate, { status: "pending" });

    const refusedF = resolvePassportCommerceFacts({
      plan,
      planning: false,
      entry: entryMap({ [FP_MANDATE_KEY]: refused("malformed_response") }),
      get: () => undefined,
      isPending: false,
      namespace: SVM_NS,
    });
    assert.deepEqual(refusedF.fixedPrice.mandate, {
      status: "refused",
      cause: "malformed_response",
    });
  });

  it("challengeOpen from openedAt; zero openedAt and absent → known false", async () => {
    const plan = await svmPlan();
    const golden = hexToBytes(challengeAccountLayout().goldenHex);
    const open = resolvePassportCommerceFacts({
      plan,
      planning: false,
      entry: entryMap({
        [CHALLENGE_ACCOUNT_KEY]: success(golden),
        [FP_CONSIGNMENT_KEY]: refused("account_not_found"),
        [ASC_CONSIGNMENT_KEY]: refused("account_not_found"),
        [PASSPORT_CONFIG_KEY]: success(
          hexToBytes(passportConfigLayout().goldenHex),
        ),
      }),
      get: () => undefined,
      isPending: false,
      namespace: SVM_NS,
    });
    assert.deepEqual(open.challengeOpen, { status: "known", value: true });

    const closed = new Uint8Array(golden);
    closed.fill(0, 40, 48);
    const closedFacts = resolvePassportCommerceFacts({
      plan,
      planning: false,
      entry: entryMap({
        [CHALLENGE_ACCOUNT_KEY]: success(closed),
        [FP_CONSIGNMENT_KEY]: refused("account_not_found"),
        [ASC_CONSIGNMENT_KEY]: refused("account_not_found"),
        [PASSPORT_CONFIG_KEY]: success(
          hexToBytes(passportConfigLayout().goldenHex),
        ),
      }),
      get: () => undefined,
      isPending: false,
      namespace: SVM_NS,
    });
    assert.deepEqual(closedFacts.challengeOpen, {
      status: "known",
      value: false,
    });

    const absent = resolvePassportCommerceFacts({
      plan,
      planning: false,
      entry: entryMap({
        [CHALLENGE_ACCOUNT_KEY]: refused("account_not_found"),
        [FP_CONSIGNMENT_KEY]: refused("account_not_found"),
        [ASC_CONSIGNMENT_KEY]: refused("account_not_found"),
        [PASSPORT_CONFIG_KEY]: success(
          hexToBytes(passportConfigLayout().goldenHex),
        ),
      }),
      get: () => undefined,
      isPending: false,
      namespace: SVM_NS,
    });
    assert.deepEqual(absent.challengeOpen, { status: "known", value: false });
  });

  it("registry known from config golden; config absent → refused account_not_found", async () => {
    const plan = await svmPlan();
    const known = resolvePassportCommerceFacts({
      plan,
      planning: false,
      entry: entryMap({
        [PASSPORT_CONFIG_KEY]: success(
          hexToBytes(passportConfigLayout().goldenHex),
        ),
        [FP_CONSIGNMENT_KEY]: refused("account_not_found"),
        [ASC_CONSIGNMENT_KEY]: refused("account_not_found"),
        [CHALLENGE_ACCOUNT_KEY]: refused("account_not_found"),
      }),
      get: () => undefined,
      isPending: false,
      namespace: SVM_NS,
    });
    assert.equal(known.encumbranceRegistry.status, "known");
    if (known.encumbranceRegistry.status === "known") {
      assert.ok(Array.isArray(known.encumbranceRegistry.value));
    }

    const absent = resolvePassportCommerceFacts({
      plan,
      planning: false,
      entry: entryMap({
        [PASSPORT_CONFIG_KEY]: refused("account_not_found"),
      }),
      get: () => undefined,
      isPending: false,
      namespace: SVM_NS,
    });
    assert.deepEqual(absent.encumbranceRegistry, {
      status: "refused",
      cause: "account_not_found",
    });
  });

  it("may_* without inject stay reads_unresolved (never product_owner_owed)", async () => {
    const plan = await svmPlan();
    const facts = resolvePassportCommerceFacts({
      plan,
      planning: false,
      entry: () => undefined,
      get: () => undefined,
      isPending: false,
      namespace: SVM_NS,
    });
    assert.equal(
      facts.openConsignmentPermission.status === "blocked" &&
        facts.openConsignmentPermission.cause,
      "reads_unresolved",
    );
    assert.equal(
      facts.leaveChainPermission.status === "blocked" &&
        facts.leaveChainPermission.cause,
      "reads_unresolved",
    );
  });

  it("mayPermissions inject carries simulate gate", async () => {
    const plan = await svmPlan();
    const refused = { status: "blocked" as const, cause: "refused" as const };
    const facts = resolvePassportCommerceFacts({
      plan,
      planning: false,
      entry: () => undefined,
      get: () => undefined,
      isPending: false,
      namespace: SVM_NS,
      mayPermissions: {
        openConsignmentPermission: refused,
        leaveChainPermission: {
          status: "blocked",
          cause: "source_unanswerable",
          source: { presence: "not_carried_by_vm" },
        },
      },
    });
    assert.deepEqual(facts.openConsignmentPermission, refused);
    assert.equal(
      facts.leaveChainPermission.status === "blocked" &&
        facts.leaveChainPermission.cause,
      "source_unanswerable",
    );
  });
});
