/**
 * Sole wallet-rejection classifier — typed shapes only; message matches redden.
 * Cause-table cancel literals outside this owner redden.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UserRejectedRequestError } from "viem";

import { mintPassportCauseCopy } from "@/lib/passport/mint-passport";
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

/**
 * `wallet_rejected` key whose following string literal contains "cancel"
 * (object property or Record entry). Owner file is exempt.
 */
function walletRejectedCancelLiteralViolations(
  rel: string,
  source: string,
): string | false {
  if (rel === OWNER_REL) return false;
  // Property / Record entry with a string literal containing cancel (not walletRejectionCopy()).
  const prop = /wallet_rejected\s*:\s*["'`]([^"'`]*)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = prop.exec(source)) != null) {
    if (/cancel/i.test(m[1]!)) {
      return `second wallet_rejected cancel sentence in ${rel}`;
    }
  }
  return false;
}

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

  it("mint wallet_rejected delegates to walletRejectionCopy", () => {
    assert.equal(
      mintPassportCauseCopy("wallet_rejected"),
      walletRejectionCopy(),
    );
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

  it("plant: wallet_rejected cancel literal outside owner is red; live tree clean", () => {
    const plantSrc = `
const MINT_PASSPORT_CAUSE_COPY = {
  wallet_rejected:
    "You cancelled the wallet request. Nothing was submitted.",
};
`;
    assert.equal(
      walletRejectedCancelLiteralViolations(
        "lib/passport/mint-passport.ts",
        plantSrc,
      ),
      "second wallet_rejected cancel sentence in lib/passport/mint-passport.ts",
    );

    const owners = [OWNER_REL];
    assert.throws(
      () =>
        assertCleanProductScan(
          {
            filesRead: 1,
            violations: [
              {
                path: "lib/passport/mint-passport.ts",
                reason:
                  "second wallet_rejected cancel sentence in lib/passport/mint-passport.ts",
              },
            ],
            unreadable: [],
          },
          { owners, allowEmptyTargets: true },
        ),
      /second wallet_rejected cancel sentence/,
    );

    const scan = scanProductSources(
      (rel, source) => walletRejectedCancelLiteralViolations(rel, source),
      { owners },
    );
    assertCleanProductScan(scan, { owners });
  });
});
