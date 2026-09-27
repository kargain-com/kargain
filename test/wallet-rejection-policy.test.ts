/**
 * Sole wallet-rejection classifier — typed shapes only; message matches redden.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UserRejectedRequestError } from "viem";

import {
  isWalletRejection,
  walletRejectionCopy,
  WALLET_REJECTION_COPY,
} from "@/lib/web3/wallet-rejection";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const OWNER_REL = "lib/web3/wallet-rejection.ts";

describe("wallet-rejection owner", () => {
  it("classifies viem UserRejectedRequestError and EIP-1193 4001", () => {
    assert.equal(
      isWalletRejection(new UserRejectedRequestError(new Error("x"))),
      true,
    );
    assert.equal(isWalletRejection({ code: 4001 }), true);
    assert.equal(isWalletRejection({ code: "4001" }), true);
    assert.equal(isWalletRejection({ code: "USER_REJECTED" }), true);
    assert.equal(
      isWalletRejection({ name: "WalletSignAndInjectionRejectedError" }),
      true,
    );
  });

  it("does not classify message-only User rejected strings", () => {
    assert.equal(
      isWalletRejection(new Error("User rejected the request")),
      false,
    );
    assert.equal(isWalletRejection(new Error("User denied")), false);
    assert.equal(isWalletRejection(new Error("Custom(1)")), false);
  });

  it("sole sentence is stable", () => {
    assert.equal(walletRejectionCopy(), WALLET_REJECTION_COPY);
    assert.match(WALLET_REJECTION_COPY, /cancelled/i);
  });

  it("plant: message.includes User rejected under product roots is red", () => {
    const owners = [OWNER_REL];
    const forbidden =
      /message\.includes\(\s*["']User rejected["']\s*\)|message\.includes\(\s*["']User denied["']\s*\)/;
    assert.throws(
      () =>
        assertCleanProductScan(
          {
            filesRead: 1,
            violations: [
              {
                path: "components/passport/create-passport-wizard.tsx",
                reason: 're-introduced message.includes("User rejected")',
              },
            ],
            unreadable: [],
          },
          { owners, allowEmptyTargets: true },
        ),
      /re-introduced message\.includes/,
    );
    const scan = scanProductSources((rel, source) => {
      if (rel === OWNER_REL) return false;
      if (forbidden.test(source)) {
        return `re-introduced message-based wallet rejection in ${rel}`;
      }
      return false;
    }, { owners });
    assertCleanProductScan(scan, { owners });
  });
});
