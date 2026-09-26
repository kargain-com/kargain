/**
 * SVM session preference — wallet name only; never addresses.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SVM_LAST_WALLET_STORAGE_KEY,
  clearSvmLastWalletName,
  readSvmLastWalletName,
  writeSvmLastWalletName,
  type SvmSessionPreferenceStore,
} from "../lib/web3/svm-session-preference.ts";
import { pickSvmConnectAccount } from "../lib/web3/svm-session-connect.ts";
import type { Wallet } from "@wallet-standard/base";

function memoryStore(
  initial: Record<string, string> = {},
): SvmSessionPreferenceStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

describe("svm-session-preference", () => {
  it("write → read → clear round-trip; blank names ignored", () => {
    const store = memoryStore();
    assert.equal(readSvmLastWalletName(store), null);

    writeSvmLastWalletName("Phantom", store);
    assert.equal(readSvmLastWalletName(store), "Phantom");
    assert.equal(store.data[SVM_LAST_WALLET_STORAGE_KEY], "Phantom");

    writeSvmLastWalletName("  ", store);
    assert.equal(readSvmLastWalletName(store), "Phantom");

    clearSvmLastWalletName(store);
    assert.equal(readSvmLastWalletName(store), null);
    assert.equal(store.data[SVM_LAST_WALLET_STORAGE_KEY], undefined);
  });

  it("null store is a no-op (SSR / private mode)", () => {
    assert.equal(readSvmLastWalletName(null), null);
    writeSvmLastWalletName("Phantom", null);
    clearSvmLastWalletName(null);
  });

  it("constructed: inventing an address from preference alone is red", () => {
    const store = memoryStore({
      [SVM_LAST_WALLET_STORAGE_KEY]: "Phantom",
    });
    const name = readSvmLastWalletName(store);
    assert.equal(name, "Phantom");
    // Preference is a product wallet name — hydrate requires Wallet Standard accounts.
    assert.equal(typeof name, "string");
    assert.notEqual(name, "65Qmw9zhpkjxJApmFngx3dxmGo2KiZ4kyJycLsWh4gU9");
    assert.ok(
      pickSvmConnectAccount([], { accounts: [] } as unknown as Wallet) ===
        undefined,
      "empty connect + empty wallet accounts → no invent",
    );
  });
});

describe("pickSvmConnectAccount", () => {
  it("prefers connect output accounts[0], else wallet.accounts[0]", () => {
    const fromConnect = {
      address: "FromConnect1111111111111111111111111111111",
    };
    const fromWallet = {
      address: "FromWallet2222222222222222222222222222222",
    };
    const wallet = {
      accounts: [fromWallet],
    } as unknown as Wallet;

    assert.equal(
      pickSvmConnectAccount([fromConnect as never], wallet)?.address,
      fromConnect.address,
    );
    assert.equal(pickSvmConnectAccount([], wallet)?.address, fromWallet.address);
    assert.equal(
      pickSvmConnectAccount([], { accounts: [] } as unknown as Wallet),
      undefined,
    );
  });
});
