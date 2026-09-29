/**
 * Unit W — typed SVM write owner refusal + adapter text-classify ban.
 * In-memory plants only for policy scanners; never mutate live product tree.
 */

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { getBase58Decoder } from "@solana/kit";

import { executeOpenFixedPriceConsignment } from "@/lib/commerce/open-fixed-price-consignment";
import { ZERO_ADDRESS } from "@/lib/commerce/consignment";
import { DENOMINATION_KIND, ZERO_CURRENCY_CODE } from "@/lib/commerce/denomination";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { executeOpenChallenge } from "@/lib/passport/open-challenge";
import {
  mintPassportCauseCopy,
  sendMintPassport,
} from "@/lib/passport/mint-passport";
import { executeSetPassportUri } from "@/lib/passport/set-passport-uri";
import { ensureIrysDeposit } from "@/lib/storage/irys-deposit";
import { createMemoryIrysDepositRecordStore } from "@/lib/storage/irys-deposit-record";
import { executeSetVerificationFee } from "@/lib/verifier/set-verification-fee";
import {
  commercialSvmNamespaceIds,
  requireSvmCommercialActive,
} from "@/lib/web3/commercial-active";
import { WALLET_REJECTION_COPY } from "@/lib/web3/wallet-rejection";
import {
  isSvmWriteOwnerRefusal,
  SvmWriteOwnerRefusal,
  svmWriteOwnerRefusalCopy,
} from "@/lib/web3/svm-write-owner-refusal";
import { txRefusalFromWriteFnError } from "@/lib/web3/tx-refusal";
import {
  FIXTURE_SVM_NAMESPACE,
  FIXTURE_SVM_STACK,
} from "./fixtures/commercial-svm-stack.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCK_BLOCKHASH = getBase58Decoder().decode(new Uint8Array(32).fill(7));
const SVM_OWNER = "So11111111111111111111111111111111111111112";

function rejectingPort() {
  return {
    async signAndSendTransaction() {
      throw { name: "WalletSignAndInjectionRejectedError", error: "rejected" };
    },
  };
}

function mockBlockhashOk() {
  return async () =>
    ({
      ok: true as const,
      value: {
        blockhash: MOCK_BLOCKHASH,
        lastValidBlockHeight: 1_000_000n,
      },
    }) as const;
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTsFiles(full, out);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Ban messageText.includes / .message.includes under lib/web3/svm-*.ts */
function findSvmMessageIncludes(rootDir: string): string[] {
  const web3 = path.join(rootDir, "lib/web3");
  const hits: string[] = [];
  for (const file of walkTsFiles(web3)) {
    const base = path.basename(file);
    if (!base.startsWith("svm-") || !base.endsWith(".ts")) continue;
    const rel = path.relative(rootDir, file);
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (
        /messageText\.includes/.test(line) ||
        /\.message\.includes/.test(line)
      ) {
        hits.push(`${rel}:${i + 1}`);
      }
    }
  }
  return hits;
}

/** Ban `throw new Error(` whose argument contains `refused:` under lib/. */
function findRefusedErrorThrows(rootDir: string): string[] {
  const libRoot = path.join(rootDir, "lib");
  const hits: string[] = [];
  for (const file of walkTsFiles(libRoot)) {
    const rel = path.relative(rootDir, file);
    const src = readFileSync(file, "utf8");
    // Multi-line throws: scan with a window after each `throw new Error(`
    const re = /throw\s+new\s+Error\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) != null) {
      const slice = src.slice(m.index, m.index + 280);
      if (/refused:/.test(slice)) {
        const line = src.slice(0, m.index).split("\n").length;
        hits.push(`${rel}:${line}`);
      }
    }
  }
  return hits;
}

describe("svm message.includes / messageText.includes ban", () => {
  it("live lib/web3/svm-*.ts has zero messageText.includes / .message.includes", () => {
    assert.deepEqual(findSvmMessageIncludes(ROOT), []);
  });

  it("in-memory plant with messageText.includes is red then green when removed", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "svm-msg-inc-"));
    mkdirSync(path.join(tmp, "lib/web3"), { recursive: true });
    const plantPath = path.join(tmp, "lib/web3/svm-write-adapter.ts");
    writeFileSync(
      plantPath,
      `const messageText = err instanceof Error ? err.message : String(err);\nif (messageText.includes("solana:signAndSendTransaction")) {}\n`,
    );
    const red = findSvmMessageIncludes(tmp);
    assert.ok(
      red.some((h) => h.includes("svm-write-adapter.ts")),
      `expected plant hit, got ${JSON.stringify(red)}`,
    );
    writeFileSync(
      plantPath,
      `if (isWalletRejection(err)) return refuse("wallet_rejected", "wallet_rejected");\n`,
    );
    assert.deepEqual(findSvmMessageIncludes(tmp), []);
  });
});

describe("lib/ throw new Error(… refused: …) ban", () => {
  it("live lib/ has zero throw new Error containing refused:", () => {
    assert.deepEqual(findRefusedErrorThrows(ROOT), []);
  });

  it("in-memory plant with refused: Error throw is red then green when removed", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "svm-refused-"));
    mkdirSync(path.join(tmp, "lib/passport"), { recursive: true });
    const plantPath = path.join(tmp, "lib/passport/set-passport-uri.ts");
    writeFileSync(
      plantPath,
      `throw new Error(\`setPassportUri refused: \${sent.cause}:\${sent.detail}\`);\n`,
    );
    const red = findRefusedErrorThrows(tmp);
    assert.ok(
      red.some((h) => h.includes("set-passport-uri.ts")),
      `expected plant hit, got ${JSON.stringify(red)}`,
    );
    writeFileSync(
      plantPath,
      `throwSvmWriteSendRefusal("setPassportUri", sent);\n`,
    );
    assert.deepEqual(findRefusedErrorThrows(tmp), []);
  });
});

describe("runTx family: SvmWriteOwnerRefusal → TxRefusal", () => {
  const ns = commercialSvmNamespaceIds()[0]!;

  it("passport set-uri: wallet reject → wallet_rejected; plan refuse typed sentence", async () => {
    await assert.rejects(
      () =>
        executeSetPassportUri({
          account: { status: "connected", vm: "svm", address: SVM_OWNER },
          chainId: ns,
          tokenId: "1",
          uri: "ar://x",
          writeEvmContract: async () => {
            throw new Error("evm must not run");
          },
          svmPort: rejectingPort(),
          fetchBlockhash: mockBlockhashOk(),
        }),
      (err: unknown) => {
        assert.ok(isSvmWriteOwnerRefusal(err));
        assert.equal(err.cause, "wallet_rejected");
        assert.equal(txRefusalFromWriteFnError(err).kind, "wallet_rejected");
        assert.equal(txErrorMessage(err), WALLET_REJECTION_COPY);
        return true;
      },
    );

    await assert.rejects(
      () =>
        executeSetPassportUri({
          account: { status: "disconnected" },
          chainId: ns,
          tokenId: "1",
          uri: "ar://x",
          writeEvmContract: async () => "0xabc" as `0x${string}`,
        }),
      (err: unknown) => {
        assert.ok(isSvmWriteOwnerRefusal(err));
        assert.equal(err.cause, "disconnected");
        const refusal = txRefusalFromWriteFnError(err);
        assert.equal(refusal.kind, "write_refused");
        const copy = txErrorMessage(err);
        assert.doesNotMatch(copy, /refused:/);
        assert.equal(copy, svmWriteOwnerRefusalCopy(err));
        return true;
      },
    );
  });

  it("challenge open: wallet reject → wallet_rejected", async () => {
    await assert.rejects(
      () =>
        executeOpenChallenge({
          account: { status: "connected", vm: "svm", address: SVM_OWNER },
          chainId: ns,
          tokenId: "1",
          writeEvmContract: async () => {
            throw new Error("evm must not run");
          },
          svmPort: rejectingPort(),
          fetchBlockhash: mockBlockhashOk(),
        }),
      (err: unknown) => {
        assert.ok(isSvmWriteOwnerRefusal(err));
        assert.equal(err.cause, "wallet_rejected");
        assert.equal(txRefusalFromWriteFnError(err).kind, "wallet_rejected");
        return true;
      },
    );
  });

  it("verifier fee: wallet reject → wallet_rejected", async () => {
    await assert.rejects(
      () =>
        executeSetVerificationFee({
          account: { status: "connected", vm: "svm", address: SVM_OWNER },
          chainId: ns,
          marginNative: 42n,
          writeEvmContract: async () => {
            throw new Error("evm must not run");
          },
          svmPort: rejectingPort(),
          fetchBlockhash: mockBlockhashOk(),
        }),
      (err: unknown) => {
        assert.ok(isSvmWriteOwnerRefusal(err));
        assert.equal(err.cause, "wallet_rejected");
        assert.equal(txRefusalFromWriteFnError(err).kind, "wallet_rejected");
        return true;
      },
    );
  });

  it("commerce open-fixed-price: wallet reject → wallet_rejected", async () => {
    const stack = requireSvmCommercialActive(ns);
    await assert.rejects(
      () =>
        executeOpenFixedPriceConsignment({
          account: { status: "connected", vm: "svm", address: stack.deployer },
          chainId: ns,
          tokenId: "1",
          denominationKind: DENOMINATION_KIND.Asset,
          currencyCode: ZERO_CURRENCY_CODE,
          settlementAsset: ZERO_ADDRESS,
          price: 2_000_000n,
          encumbranceSeedPrefix: new TextEncoder().encode("fp-ans"),
          writeEvmContract: async () => {
            throw new Error("evm must not run");
          },
          svmPort: rejectingPort(),
          fetchBlockhash: mockBlockhashOk(),
        }),
      (err: unknown) => {
        assert.ok(isSvmWriteOwnerRefusal(err));
        assert.equal(err.cause, "wallet_rejected");
        assert.equal(txRefusalFromWriteFnError(err).kind, "wallet_rejected");
        return true;
      },
    );
  });

  it("sentence owner never renders Error.message / detail for SvmWriteOwnerRefusal", () => {
    const refusal = new SvmWriteOwnerRefusal({
      owner: "setPassportUri",
      cause: "encode_failed",
      detail: "SECRET_DETAIL_MUST_NOT_LEAK",
    });
    const copy = svmWriteOwnerRefusalCopy(refusal);
    assert.doesNotMatch(copy, /SECRET_DETAIL/);
    assert.doesNotMatch(copy, /refused:/);
    assert.equal(txErrorMessage(refusal), copy);
  });
});

describe("mint SVM wallet rejection", () => {
  it("sendMintPassport maps port rejection to wallet_rejected + rejection sentence", async () => {
    const stubPlan = {
      ok: true as const,
      vm: "svm" as const,
      plan: {
        programId: FIXTURE_SVM_STACK.karPassport,
        data: new Uint8Array([1, 2, 3]),
        accounts: [],
        feePayer: SVM_OWNER,
        plannedTokenId: "1",
        plannedNextTokenId: "2",
        configAddress: SVM_OWNER,
      },
    };
    const sent = await sendMintPassport({
      plan: stubPlan as never,
      account: { status: "connected", vm: "svm", address: SVM_OWNER },
      chainId: FIXTURE_SVM_NAMESPACE,
      writeEvmContract: async () => {
        throw new Error("evm");
      },
      svmPort: rejectingPort(),
      fetchBlockhash: mockBlockhashOk(),
      registry: {
        [FIXTURE_SVM_NAMESPACE]: FIXTURE_SVM_STACK,
      } as never,
    });
    assert.equal(sent.ok, false);
    if (sent.ok) throw new Error("expected refusal");
    assert.equal(sent.cause, "wallet_rejected");
    assert.match(mintPassportCauseCopy("wallet_rejected"), /cancelled/i);
  });
});

describe("Irys deposit SVM wallet rejection", () => {
  it("sendSvmNativeTransfer wallet_rejected → deposit wallet_rejected", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const payer = "So11111111111111111111111111111111111111112";
    const bundler = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    const uploader = {
      getPrice: async () => ({ toString: () => "1000" }),
      getBalance: async () => ({ toString: () => "0" }),
      utils: {
        getBundlerAddress: async () => bundler,
      },
      tokenConfig: { minConfirm: 1 },
    };
    const r = await ensureIrysDeposit({
      stack: FIXTURE_SVM_STACK,
      account: {
        status: "connected",
        vm: "svm",
        address: payer,
      },
      uploader: uploader as never,
      totalBytes: 100,
      paymentToken: "solana",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store,
        svmSignAndSend: rejectingPort(),
        fetchSvmBlockhash: mockBlockhashOk(),
        confirmSvmFunding: {
          confirmSubmission: async () => {
            throw new Error("must not confirm");
          },
        },
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(
        r.cause,
        "wallet_rejected",
        `expected wallet_rejected, got ${r.cause}`,
      );
    }
  });
});
