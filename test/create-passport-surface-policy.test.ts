/**
 * Create passport surface — support before session.
 *
 * Pins: Solana shows authority_only (not Ethereum wrong_vm); EVM disconnected
 * sentence unchanged; admitting ns + SVM → wrong_vm; wizard consumes owners;
 * no inlined sentences; plant of requireEvmSession-first is red.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DISCONNECTED_ACCOUNT,
  evmSessionRefusalCopy,
  requireEvmSession,
  svmActiveAccountFromAddress,
  wrongVmActionCopy,
  type ActiveAccount,
} from "@/lib/web3/active-account";
import { commercialNetworkLabel } from "@/lib/web3/chain-selector-state";
import { mintKargainNamespace } from "@/lib/web3/kargain-namespace";
import {
  admitCreatePassport,
  createPassportSupportRefusalCopy,
  createPassportWhereAvailableCopy,
  resolveCreatePassportNamespace,
} from "@/lib/passport/create-passport-surface";
import {
  surfaceSupport,
  surfaceSupportCauseCopy,
} from "@/lib/web3/surface-support";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOLANA_NS = 2_000_040_168;
const OWNER_REL = "lib/passport/create-passport-surface.ts";
const WIZARD_REL = "components/passport/create-passport-wizard.tsx";

const EVM_ACCOUNT: ActiveAccount = {
  status: "connected",
  vm: "evm",
  address: "0x1111111111111111111111111111111111111111",
  namespace: mintKargainNamespace(84532),
  chainId: 84532,
};

const SVM_ACCOUNT = svmActiveAccountFromAddress(
  "D87okZNVcTr7AAb9mnH6mBTwS9HRryhaq7XNLzUwxKCb",
);

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("admitCreatePassport — support before session", () => {
  it("2000040168: authority_only for any session; never Ethereum wrong_vm", () => {
    const authority = surfaceSupportCauseCopy("authority_only");
    const ethereum = wrongVmActionCopy("evm");
    for (const account of [
      DISCONNECTED_ACCOUNT,
      EVM_ACCOUNT,
      SVM_ACCOUNT,
    ] as const) {
      const admission = admitCreatePassport(account, SOLANA_NS);
      assert.equal(admission.status, "support_refused");
      if (admission.status !== "support_refused") return;
      assert.equal(admission.cause, "authority_only");
      const copy = createPassportSupportRefusalCopy(admission.cause);
      assert.equal(copy.title, authority);
      assert.notEqual(copy.title, ethereum);
      assert.ok(!copy.title.includes("Ethereum"));
      assert.ok(!copy.detail.includes("Ethereum wallet"));
    }
    const cell = surfaceSupport("create_passport", SOLANA_NS);
    assert.ok(!("unresolved" in cell) && !cell.supported);
    if (!("unresolved" in cell) && !cell.supported) {
      assert.equal(cell.cause, "authority_only");
    }
  });

  it("plant: requireEvmSession-first on Solana yields Ethereum sentence (red vs live)", () => {
    const planted = requireEvmSession(SVM_ACCOUNT);
    assert.equal(planted.ok, false);
    if (planted.ok) return;
    assert.equal(planted.cause, "wrong_vm");
    const plantedSentence = evmSessionRefusalCopy(planted.cause);
    assert.equal(plantedSentence, wrongVmActionCopy("evm"));

    const live = admitCreatePassport(SVM_ACCOUNT, SOLANA_NS);
    assert.equal(live.status, "support_refused");
    if (live.status !== "support_refused") return;
    const liveTitle = createPassportSupportRefusalCopy(live.cause).title;
    assert.notEqual(
      liveTitle,
      plantedSentence,
      "live admit must not match old wrong_vm Ethereum sentence",
    );
    assert.equal(liveTitle, surfaceSupportCauseCopy("authority_only"));
  });

  it("84532 disconnected: disconnected sentence unchanged", () => {
    const admission = admitCreatePassport(DISCONNECTED_ACCOUNT, 84532);
    assert.equal(admission.status, "session_refused");
    if (admission.status !== "session_refused") return;
    assert.equal(admission.cause, "disconnected");
    assert.equal(
      evmSessionRefusalCopy(admission.cause),
      "Connect a wallet to continue.",
    );
  });

  it("84532 + SVM session: wrong_vm Ethereum sentence (creation admitted)", () => {
    const admission = admitCreatePassport(SVM_ACCOUNT, 84532);
    assert.equal(admission.status, "session_refused");
    if (admission.status !== "session_refused") return;
    assert.equal(admission.cause, "wrong_vm");
    assert.equal(admission.wanted, "evm");
    assert.equal(
      evmSessionRefusalCopy(admission.cause),
      wrongVmActionCopy("evm"),
    );
  });

  it("84532 + EVM connected: available with mint address/chain", () => {
    const admission = admitCreatePassport(EVM_ACCOUNT, 84532);
    assert.equal(admission.status, "available");
    if (admission.status !== "available") return;
    assert.equal(admission.address, EVM_ACCOUNT.address);
    assert.equal(admission.chainId, 84532);
    assert.equal(admission.namespace, 84532);
  });
});

describe("resolveCreatePassportNamespace", () => {
  it("commercial urlChain wins over session", () => {
    const resolved = resolveCreatePassportNamespace({
      account: SVM_ACCOUNT,
      urlChain: 84532,
    });
    assert.deepEqual(resolved, { ok: true, namespace: 84532 });
  });

  it("session namespace when urlChain absent", () => {
    const resolved = resolveCreatePassportNamespace({
      account: SVM_ACCOUNT,
      urlChain: null,
    });
    assert.deepEqual(resolved, { ok: true, namespace: SOLANA_NS });
  });

  it("disconnected with no urlChain → disconnected", () => {
    const resolved = resolveCreatePassportNamespace({
      account: DISCONNECTED_ACCOUNT,
      urlChain: null,
    });
    assert.deepEqual(resolved, { ok: false, cause: "disconnected" });
  });
});

describe("createPassportWhereAvailableCopy", () => {
  it("names only namespaces that admit create_passport; never Solana", () => {
    const detail = createPassportWhereAvailableCopy();
    assert.ok(detail.length > 0);
    assert.ok(detail.startsWith("Creation is available on "));
    assert.ok(!detail.includes(commercialNetworkLabel(SOLANA_NS)));
    assert.ok(detail.includes(commercialNetworkLabel(84532)));
    assert.ok(detail.includes(commercialNetworkLabel(11155111)));
    const solana = surfaceSupport("create_passport", SOLANA_NS);
    assert.ok(!("unresolved" in solana) && !solana.supported);
  });
});

describe("wizard consumes owners — no invent", () => {
  it("wizard calls admit + support refusal copy; no requireEvmSession gate", () => {
    const src = read(WIZARD_REL);
    assert.ok(
      /admitCreatePassport/.test(src),
      "wizard must call admitCreatePassport",
    );
    assert.ok(
      /createPassportSupportRefusalCopy/.test(src),
      "wizard must call createPassportSupportRefusalCopy",
    );
    assert.ok(
      /resolveCreatePassportNamespace/.test(src),
      "wizard must resolve namespace via owner",
    );
    assert.ok(
      !/\brequireEvmSession\b/.test(src),
      "wizard must not gate with requireEvmSession",
    );
    assert.ok(
      /mintPassport/.test(src),
      "EVM mint body must still call mintPassport",
    );
  });

  it("plant: sentence literal in wizard is red", () => {
    const authority = surfaceSupportCauseCopy("authority_only");
    const where = createPassportWhereAvailableCopy();
    const ethereum = wrongVmActionCopy("evm");
    const owners = [OWNER_REL, "lib/web3/surface-support.ts"];
    const planted = `const x = ${JSON.stringify(authority)};\n`;
    assert.ok(planted.includes(JSON.stringify(authority)));
    assert.throws(
      () =>
        assertCleanProductScan(
          {
            filesRead: 1,
            violations: [
              {
                path: WIZARD_REL,
                reason: `re-inlined authority_only: ${authority}`,
              },
            ],
            unreadable: [],
          },
          { owners, allowEmptyTargets: true },
        ),
      /re-inlined authority_only/,
    );
    const scan = scanProductSources((rel, source) => {
      if (rel !== WIZARD_REL) return false;
      for (const sentence of [authority, where, ethereum]) {
        if (source.includes(JSON.stringify(sentence)) || source.includes(sentence)) {
          return `re-inlined create-passport sentence (sole owners: surfaceSupportCauseCopy / createPassportWhereAvailableCopy): ${sentence}`;
        }
      }
      return false;
    }, { owners });
    assertCleanProductScan(scan, { owners });
  });
});

describe("owner file exists", () => {
  it("create-passport-surface.ts is the sole copy home", () => {
    const src = read(OWNER_REL);
    assert.ok(/surfaceSupport\(\s*"create_passport"/.test(src));
    assert.ok(/surfaceSupportCauseCopy/.test(src));
    assert.ok(/createPassportWhereAvailableCopy/.test(src));
  });
});
