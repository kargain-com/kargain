/**
 * Create passport surface — support before session (dual-VM).
 *
 * Pins: Solana admits create_passport for a matching SVM session; EVM
 * disconnected sentence unchanged; admitting EVM ns + SVM → wrong_family;
 * wizard consumes owners; no inlined sentences; plant of requireEvmSession-first is red.
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
import { mintKargainNamespace } from "@/lib/web3/kargain-namespace";
import {
  admitCreatePassport,
  createPassportIntroCopy,
  resolveCreatePassportNamespace,
} from "@/lib/passport/create-passport-surface";
import {
  isSurfaceAdmissionAvailable,
  surfaceAdmissionRefusalCopy,
} from "@/lib/web3/surface-admission";
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
    // Inverted: Solana create_passport is dual-VM supported.
    const ethereum = wrongVmActionCopy("evm");
    const cell = surfaceSupport("create_passport", SOLANA_NS);
    assert.ok(!("unresolved" in cell) && cell.supported);
    if (!("unresolved" in cell) && cell.supported) {
      assert.equal(cell.family, "svm");
    }

    const available = admitCreatePassport(SVM_ACCOUNT, SOLANA_NS);
    assert.equal(available.status, "available");
    assert.ok(isSurfaceAdmissionAvailable(available));

    const wrongFamily = admitCreatePassport(EVM_ACCOUNT, SOLANA_NS);
    assert.equal(wrongFamily.status, "wrong_family");
    if (wrongFamily.status !== "wrong_family") return;
    assert.equal(wrongFamily.wanted, "svm");
    assert.notEqual(
      surfaceAdmissionRefusalCopy(wrongFamily).title,
      ethereum,
    );

    const disconnected = admitCreatePassport(DISCONNECTED_ACCOUNT, SOLANA_NS);
    assert.equal(disconnected.status, "disconnected");
  });

  it("plant: requireEvmSession-first on Solana yields Ethereum sentence (red vs live)", () => {
    const planted = requireEvmSession(SVM_ACCOUNT);
    assert.equal(planted.ok, false);
    if (planted.ok) return;
    assert.equal(planted.cause, "wrong_vm");
    const plantedSentence = evmSessionRefusalCopy(planted.cause);
    assert.equal(plantedSentence, wrongVmActionCopy("evm"));

    const live = admitCreatePassport(SVM_ACCOUNT, SOLANA_NS);
    assert.equal(live.status, "available");
    assert.ok(isSurfaceAdmissionAvailable(live));
    assert.notEqual(
      "available",
      plantedSentence,
      "live admit must not match old wrong_vm Ethereum sentence",
    );
  });

  it("84532 disconnected: disconnected sentence via SurfaceAdmission", () => {
    const admission = admitCreatePassport(DISCONNECTED_ACCOUNT, 84532);
    assert.equal(admission.status, "disconnected");
    assert.equal(
      surfaceAdmissionRefusalCopy(admission).title,
      "Connect a wallet to continue.",
    );
  });

  it("84532 + SVM session: wrong_family Ethereum sentence (creation admitted)", () => {
    const admission = admitCreatePassport(SVM_ACCOUNT, 84532);
    assert.equal(admission.status, "wrong_family");
    if (admission.status !== "wrong_family") return;
    assert.equal(admission.wanted, "evm");
    assert.equal(
      surfaceAdmissionRefusalCopy(admission).title,
      wrongVmActionCopy("evm"),
    );
  });

  it("84532 + EVM connected: available with mint address/chain", () => {
    const admission = admitCreatePassport(EVM_ACCOUNT, 84532);
    assert.equal(admission.status, "available");
    if (admission.status !== "available" || admission.family !== "evm") return;
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
    // Inverted: Solana admits; where-available helper deleted (unreachable).
    const solana = surfaceSupport("create_passport", SOLANA_NS);
    assert.ok(!("unresolved" in solana) && solana.supported);
    const owner = read(OWNER_REL);
    assert.ok(
      !/createPassportWhereAvailableCopy/.test(owner),
      "where-available helper must be deleted once every commercial ns admits",
    );
  });
});

describe("wizard consumes owners — no invent", () => {
  it("wizard calls admit + refusal chrome; no requireEvmSession gate", () => {
    const src = read(WIZARD_REL);
    assert.ok(
      /admitCreatePassport/.test(src),
      "wizard must call admitCreatePassport",
    );
    assert.ok(
      /SurfaceAdmissionRefusalView/.test(src),
      "wizard must render SurfaceAdmissionRefusalView",
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
      /useMintPassport|mintPassport/.test(src),
      "wizard must mint through the dual-VM owner",
    );
    assert.ok(
      !/\badmitSurfaceEvmPacked\b/.test(src),
      "wizard must not force EVM packed admission",
    );
  });

  it("plant: sentence literal in wizard is red", () => {
    const authority = surfaceSupportCauseCopy("authority_only");
    const intro = createPassportIntroCopy();
    const ethereum = wrongVmActionCopy("evm");
    const owners = [OWNER_REL, "lib/web3/surface-support.ts", "lib/passport/mint-passport.ts", "lib/web3/wallet-rejection.ts", "lib/web3/commercial-active.ts"];
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
      for (const sentence of [authority, ethereum]) {
        if (source.includes(JSON.stringify(sentence)) || source.includes(sentence)) {
          return `re-inlined create-passport sentence: ${sentence}`;
        }
      }
      // Intro must come from createPassportIntroCopy call, not a re-inlined literal
      // beyond the owner call site — allow the call, ban a second copy of the string
      // as a string literal assignment.
      if (
        source.includes(JSON.stringify(intro)) &&
        !/createPassportIntroCopy\s*\(/.test(source)
      ) {
        return `re-inlined intro without owner call: ${intro}`;
      }
      return false;
    }, { owners });
    assertCleanProductScan(scan, { owners });
  });
});

describe("owner file exists", () => {
  it("create-passport-surface.ts is the sole where-available home", () => {
    // Inverted: where-available deleted; admitSurface remains sole admit path.
    const src = read(OWNER_REL);
    assert.ok(/admitSurface/.test(src));
    assert.ok(/createPassportIntroCopy/.test(src));
    assert.ok(!/createPassportWhereAvailableCopy/.test(src));
  });
});
