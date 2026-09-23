/**
 * S8-E 7c — stand confirm + readiness controls (in-memory; no live validator).
 *
 * Red→green: blockhash expiry named + bounded retry; websocket-not-ready named.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  STAND_BLOCKHASH_EXPIRED,
  STAND_BLOCKHASH_EXPIRY_MAX_RETRIES,
  STAND_TX_FAILED,
  confirmStandSignature,
  isStandBlockhashExpired,
  sendAndConfirmStandWithExpiryRetry,
} from "../svm/stand/stand-tx-confirm.ts";
import {
  STAND_WEBSOCKET_NOT_READY,
  waitStandValidatorReady,
} from "../svm/stand/stand-validator-ready.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("svm-stand-confirm-readiness-policy", () => {
  it("expired blockhash refuses by name; non-expiry never retries (red→green)", async () => {
    let height = 100;
    const ports = {
      getBlockHeight: async () => height,
      getSignatureStatuses: async () => [null],
      nowMs: (() => {
        let t = 0;
        return () => {
          t += 1;
          return t;
        };
      })(),
      sleepMs: async () => {},
      pollIntervalMs: 1,
      timeoutMs: 50,
    };

    await assert.rejects(
      () =>
        confirmStandSignature({
          signature: "sigExpired",
          blockhash: "bh1",
          lastValidBlockHeight: 90,
          ports,
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, new RegExp(STAND_BLOCKHASH_EXPIRED));
        assert.ok(isStandBlockhashExpired(err));
        return true;
      },
    );

    // Non-expiry failure: signature err — must not be classified as expiry
    const failPorts = {
      getBlockHeight: async () => 50,
      getSignatureStatuses: async () => [
        { err: { InstructionError: [0, "Custom"] }, confirmationStatus: null },
      ],
      sleepMs: async () => {},
      pollIntervalMs: 1,
      timeoutMs: 1000,
    };
    await assert.rejects(
      () =>
        confirmStandSignature({
          signature: "sigFail",
          blockhash: "bh2",
          lastValidBlockHeight: 999,
          ports: failPorts,
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, new RegExp(STAND_TX_FAILED));
        assert.equal(isStandBlockhashExpired(err), false);
        return true;
      },
    );
  });

  it("blockhash expiry retries bounded then succeeds; other failures do not retry", async () => {
    let sendCount = 0;
    let tip = 200;
    const ports = {
      getBlockHeight: async () => tip,
      getSignatureStatuses: async (sigs: string[]) => {
        const sig = sigs[0]!;
        if (sig === "sig-final") {
          return [{ confirmationStatus: "confirmed", slot: 42 }];
        }
        return [null];
      },
      sleepMs: async () => {},
      pollIntervalMs: 1,
      timeoutMs: 200,
    };

    // First send: tip already past lastValid → expiry; second send succeeds
    const ok = await sendAndConfirmStandWithExpiryRetry({
      ports,
      maxExpiryRetries: STAND_BLOCKHASH_EXPIRY_MAX_RETRIES,
      sendOnce: async () => {
        sendCount += 1;
        if (sendCount === 1) {
          return {
            signature: "sig-stale",
            blockhash: "old",
            lastValidBlockHeight: 100, // tip 200 > 100
          };
        }
        tip = 50;
        return {
          signature: "sig-final",
          blockhash: "fresh",
          lastValidBlockHeight: 100,
        };
      },
    });
    assert.equal(ok.signature, "sig-final");
    assert.equal(ok.attempts, 2);
    assert.equal(sendCount, 2);

    // Plant: wrong retry bound — more than max would be a defect
    sendCount = 0;
    tip = 200;
    await assert.rejects(
      () =>
        sendAndConfirmStandWithExpiryRetry({
          ports,
          maxExpiryRetries: 0, // no retry
          sendOnce: async () => {
            sendCount += 1;
            return {
              signature: "sig-stale",
              blockhash: "old",
              lastValidBlockHeight: 100,
            };
          },
        }),
      new RegExp(STAND_BLOCKHASH_EXPIRED),
    );
    assert.equal(sendCount, 1);

    // Non-expiry must not retry
    sendCount = 0;
    await assert.rejects(
      () =>
        sendAndConfirmStandWithExpiryRetry({
          ports: {
            getBlockHeight: async () => 1,
            getSignatureStatuses: async () => [
              { err: "Custom(1)", confirmationStatus: null },
            ],
            sleepMs: async () => {},
            pollIntervalMs: 1,
            timeoutMs: 500,
          },
          maxExpiryRetries: 5,
          sendOnce: async () => {
            sendCount += 1;
            return {
              signature: "sig-fail",
              blockhash: "b",
              lastValidBlockHeight: 999,
            };
          },
        }),
      new RegExp(STAND_TX_FAILED),
    );
    assert.equal(sendCount, 1);
  });

  it("websocket not ready refuses by name with port + elapsed (red→green)", async () => {
    let t = 0;
    await assert.rejects(
      () =>
        waitStandValidatorReady({
          probeRpc: async () => true,
          probeWebsocket: async () => false,
          nowMs: () => {
            const cur = t;
            t += 100;
            return cur;
          },
          sleepMs: async () => {},
          budgetMs: 250,
          pollIntervalMs: 50,
          wsPort: 8900,
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, new RegExp(STAND_WEBSOCKET_NOT_READY));
        assert.match(err.message, /port=8900/);
        assert.match(err.message, /elapsedMs=/);
        return true;
      },
    );

    t = 0;
    const ready = await waitStandValidatorReady({
      probeRpc: async () => true,
      probeWebsocket: async () => true,
      nowMs: () => 0,
      sleepMs: async () => {},
      budgetMs: 1000,
    });
    assert.equal(ready.elapsedMs, 0);
  });

  it("LIVE send paths consume stand confirm door; readiness has no blind sleep loop", () => {
    const confirm = readFileSync(
      join(ROOT, "svm/stand/stand-tx-confirm.ts"),
      "utf8",
    );
    assert.match(confirm, /STAND_BLOCKHASH_EXPIRED/);
    assert.match(confirm, /STAND_BLOCKHASH_EXPIRY_MAX_RETRIES/);

    const ready = readFileSync(
      join(ROOT, "svm/stand/stand-validator-ready.ts"),
      "utf8",
    );
    assert.match(ready, /STAND_WEBSOCKET_NOT_READY/);
    assert.match(ready, /STAND_HARDHAT_CONFLICT/);

    const runSh = readFileSync(join(ROOT, "svm/stand/run-stand.sh"), "utf8");
    assert.match(runSh, /wait-stand-ready/);
    assert.doesNotMatch(runSh, /sleep 1/);

    const commerce = readFileSync(
      join(ROOT, "svm/stand/stand-passport-commerce.ts"),
      "utf8",
    );
    assert.match(commerce, /sendAndConfirmStandTransaction/);
    assert.doesNotMatch(
      commerce,
      /sendAndConfirmTransaction.*@solana\/web3\.js/,
    );

    // No product kit confirm imported into stand
    assert.doesNotMatch(confirm, /svm-tx-confirm/);
    assert.doesNotMatch(commerce, /from ["'].*svm-tx-confirm/);
  });
});
