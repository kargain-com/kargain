/**
 * П-8 — resolveIrysUploadSession + getWalletUploadProvider + call-site door.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  getWalletUploadProvider,
  resolveIrysUploadSession,
} from "../lib/passport/upload-passport-metadata.ts";
import {
  irysUploadPlanRefusalMessage,
} from "../lib/storage/irys-upload-plan.ts";
import type { ActiveAccount } from "../lib/web3/active-account.ts";
import { mintKargainNamespace } from "../lib/web3/kargain-namespace.ts";
import { FIXTURE_SVM_STACK } from "./fixtures/commercial-svm-stack.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const EVM: ActiveAccount = {
  status: "connected",
  vm: "evm",
  address: "0x0000000000000000000000000000000000000001",
  namespace: mintKargainNamespace(84532),
  chainId: 84532,
};

const SVM: ActiveAccount = {
  status: "connected",
  vm: "svm",
  address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
};

const IRYS_CALL_SITES = [
  "components/passport/create-passport-wizard.tsx",
  "components/passport/edit-passport-wizard.tsx",
  "components/passport/passport-actions-panel.tsx",
  "components/kar-pro/kar-pro-join-form.tsx",
  "components/kar-pro/kar-pro-profile-section.tsx",
] as const;

describe("resolveIrysUploadSession / getWalletUploadProvider", () => {
  it("EVM session resolves commercial stack without inventing SVM chain id", async () => {
    const fakeProvider = { request: async () => "0x14a34" };
    const session = await resolveIrysUploadSession({
      account: EVM,
      evmConnector: {
        getProvider: async () => fakeProvider,
      },
    });
    assert.equal(session.stack.vm, "evm");
    assert.equal(Number(session.stack.namespace), 84532);
    assert.equal(session.provider, fakeProvider);
  });

  it("SVM session resolves live commercial namespace + wallet handle", async () => {
    const wallet = { name: "Fake", accounts: [], features: {} };
    const session = await resolveIrysUploadSession({
      account: SVM,
      svmWallet: wallet as never,
    });
    assert.equal(session.stack.vm, "svm");
    assert.equal(Number(session.stack.namespace), Number(FIXTURE_SVM_STACK.namespace));
    assert.equal(session.provider, wallet);
  });

  it("disconnected refuses before provider lookup", async () => {
    await assert.rejects(
      () =>
        resolveIrysUploadSession({
          account: { status: "disconnected" },
        }),
      /Connect your wallet to continue/,
    );
  });

  it("SVM without wallet handle refuses by name", async () => {
    await assert.rejects(
      () =>
        getWalletUploadProvider({
          account: SVM,
          svmWallet: null,
        }),
      /Connect your wallet to continue/,
    );
  });

  it("missing commercial stack after namespace resolve uses wrong_vm copy", async () => {
    // Constructed: EVM account whose namespace is not commercial — mint a fake
    // account that commercialNamespaceOf accepts (evm path returns account.namespace)
    // but commercialActive misses.
    const orphan: ActiveAccount = {
      status: "connected",
      vm: "evm",
      address: "0x00000000000000000000000000000000000000aa",
      namespace: mintKargainNamespace(8453),
      chainId: 8453,
    };
    await assert.rejects(
      () =>
        resolveIrysUploadSession({
          account: orphan,
          evmConnector: { getProvider: async () => ({}) },
        }),
      new RegExp(irysUploadPlanRefusalMessage("wrong_vm").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });
});

describe("Irys call-site door (no VM fork in wizards)", () => {
  it("upload surfaces never call getWalletUploadProvider and never branch on account.vm", () => {
    for (const rel of IRYS_CALL_SITES) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      assert.equal(
        /\bgetWalletUploadProvider\b/.test(src),
        false,
        `${rel} must not call getWalletUploadProvider (door is resolve/upload owners)`,
      );
      assert.equal(
        /account\.vm\s*===/.test(src),
        false,
        `${rel} must not fork Irys on account.vm`,
      );
    }
  });

  it("constructed wizard VM fork is red", () => {
    const dirty =
      'if (account.vm === "svm") { await uploadPassportToIrys({ svmWallet }); }\n';
    assert.match(dirty, /account\.vm\s*===/);
  });
});
