/**
 * SVM keyed-read owner + EVM multicall pin (U7).
 *
 * Completes the fail-closed stub: async source, live svm-rpc reader, unresolved
 * when no source. Does not migrate panels.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  resolveSvmKeyedReads,
  type SvmKeyedAccountSource,
} from "@/lib/web3/svm-keyed-read";
import {
  createProductSvmKeyedAccountSource,
  fetchProductSvmAccountData,
} from "@/lib/web3/svm-rpc";
import {
  assertCleanProductScan,
  scanProductSources,
  type ProductSourcePredicate,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEYED_MULTICALL_REL = "lib/web3/keyed-multicall.ts";
const SVM_KEYED_REL = "lib/web3/svm-keyed-read.ts";
const SVM_RPC_REL = "lib/web3/svm-rpc.ts";

/** Running count of getAccountData invocations (report). */
let ACCOUNT_READS_EXERCISED = 0;

function countingSource(
  inner: SvmKeyedAccountSource["getAccountData"],
): SvmKeyedAccountSource {
  return {
    getAccountData: async (account) => {
      ACCOUNT_READS_EXERCISED += 1;
      return inner(account);
    },
  };
}

describe("svm keyed-read policy", () => {
  it("no source configured → every entry fails unresolved_namespace", async () => {
    const { entries, cause } = await resolveSvmKeyedReads([
      { key: "a", account: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      { key: "b", account: "11111111111111111111111111111111" },
    ]);
    assert.equal(cause, "unresolved_namespace");
    assert.equal(entries.length, 2);
    for (const e of entries) {
      assert.equal(e.status, "failure");
      if (e.status === "failure") {
        assert.equal(e.error.message, "unresolved_namespace");
      }
    }
  });

  it("injected source returns bytes; absent account is named (never empty buffer)", async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const source = countingSource(async (a) =>
      a === "acct" ? bytes : null,
    );
    const { entries, cause } = await resolveSvmKeyedReads(
      [
        { key: "hit", account: "acct" },
        { key: "miss", account: "missing" },
      ],
      source,
    );
    assert.equal(cause, null);
    assert.equal(entries[0]!.status, "success");
    if (entries[0]!.status === "success") {
      assert.deepEqual(entries[0]!.result, bytes);
      assert.ok(entries[0]!.result.length > 0);
    }
    assert.equal(entries[1]!.status, "failure");
    if (entries[1]!.status === "failure") {
      assert.match(entries[1]!.error.message, /^account_not_found:/);
    }
    assert.equal(ACCOUNT_READS_EXERCISED, 2);
  });

  it("fetchProductSvmAccountData refuses by name when RPC URL is unset", async () => {
    const prev = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    try {
      const result = await fetchProductSvmAccountData("acct");
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.cause, "rpc_unavailable");
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
      else process.env.NEXT_PUBLIC_SOLANA_RPC_URL = prev;
    }
  });

  it("createProductSvmKeyedAccountSource maps account_not_found to null via mocked fetch", async () => {
    const prevUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "https://example.invalid/svm-rpc";
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: null } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const source = createProductSvmKeyedAccountSource();
      const wrapped = countingSource((a) => source.getAccountData(a));
      const data = await wrapped.getAccountData("Absent1111111111111111111111111111111");
      assert.equal(data, null);
      assert.equal(fetchCalls, 1);
      assert.ok(ACCOUNT_READS_EXERCISED >= 3);
    } finally {
      globalThis.fetch = originalFetch;
      if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
      else process.env.NEXT_PUBLIC_SOLANA_RPC_URL = prevUrl;
    }
  });

  it("mixed EVM/SVM batch refusal string stays pinned; planted removal turns red", () => {
    const owner = readFileSync(path.join(ROOT, KEYED_MULTICALL_REL), "utf8");
    const MIXED =
      'throw new Error("keyed-multicall: refuse mixed EVM/SVM batches")';
    assert.ok(owner.includes(MIXED), "live owner must refuse mixed batches by name");

    const plantedRemoval = owner.replace(MIXED, "// planted: mixed refusal removed");
    assert.ok(
      !plantedRemoval.includes(MIXED),
      "planted removal must clear the refusal",
    );
    assert.ok(
      owner.includes(MIXED),
      "restoring live source — plant is in-memory only",
    );
  });

  it("EVM arm keeps wagmi useReadContracts + KeyedEntry shape; SVM-arm plant turns red", () => {
    const owner = readFileSync(path.join(ROOT, KEYED_MULTICALL_REL), "utf8");

    // Live EVM form pins.
    assert.match(
      owner,
      /import\s*\{[^}]*useReadContracts[^}]*\}\s*from\s*["']wagmi["']/,
    );
    assert.ok(owner.includes("status: \"success\""));
    assert.ok(owner.includes("status: \"failure\""));
    assert.ok(owner.includes("entry: (key: K)"));
    assert.ok(owner.includes("get: (key: K)"));
    // EVM path must still gate wagmi with !isSvmBatch (enabled && !isSvmBatch).
    assert.ok(
      owner.includes("&& !isSvmBatch") ||
        owner.includes("enabled && !isSvmBatch") ||
        /const enabled = \(query\?\.enabled \?\? true\) && !isSvmBatch/.test(
          owner,
        ),
      "EVM wagmi must stay disabled for SVM batches",
    );

    // Plant: force wagmi enabled on SVM batches (would corrupt EVM/SVM separation).
    const planted = owner.replace(
      /const enabled = \(query\?\.enabled \?\? true\) && !isSvmBatch;/,
      "const enabled = query?.enabled ?? true; // planted: svm enables wagmi",
    );
    assert.ok(
      !/const enabled = \(query\?\.enabled \?\? true\) && !isSvmBatch;/.test(
        planted,
      ),
      "planted change must break the EVM disable guard",
    );
    assert.ok(
      /const enabled = \(query\?\.enabled \?\? true\) && !isSvmBatch;/.test(
        owner,
      ),
      "live source retains the guard (plant in-memory only)",
    );
  });

  it("product default wires createProductSvmKeyedAccountSource; explicit null stays possible", () => {
    const owner = readFileSync(path.join(ROOT, KEYED_MULTICALL_REL), "utf8");
    assert.ok(
      owner.includes("createProductSvmKeyedAccountSource"),
      "product default source must come from svm-rpc",
    );
    assert.ok(
      owner.includes("svmAccountSource !== undefined"),
      "omit vs explicit null must be distinguished",
    );
  });

  it("panels never call resolveSvmKeyedReads or getAccountInfo", () => {
    const ban: ProductSourcePredicate = (rel, text) => {
      if (
        !(
          rel.startsWith("app/") ||
          rel.startsWith("components/") ||
          rel.startsWith("hooks/")
        )
      ) {
        return false;
      }
      if (
        /resolveSvmKeyedReads|createProductSvmKeyedAccountSource|fetchProductSvmAccountData|getAccountInfo/.test(
          text,
        )
      ) {
        return `panel_keyed_read (${rel})`;
      }
      return false;
    };
    assertCleanProductScan(scanProductSources(ban));
  });

  it("reports account-read exercise count for the ship report", () => {
    assert.ok(
      ACCOUNT_READS_EXERCISED >= 3,
      `expected ≥3 account reads, got ${ACCOUNT_READS_EXERCISED}`,
    );
    console.log(`U7_ACCOUNT_READS_EXERCISED=${ACCOUNT_READS_EXERCISED}`);
  });
});

describe("svm keyed-read async signature", () => {
  it("resolveSvmKeyedReads returns a Promise", () => {
    const pending = resolveSvmKeyedReads([]);
    assert.ok(pending instanceof Promise);
    return pending.then((r) => {
      assert.equal(r.cause, "unresolved_namespace");
      assert.deepEqual(r.entries, []);
    });
  });

  it("SvmKeyedAccountSource is async-only (owner source text)", () => {
    const text = readFileSync(path.join(ROOT, SVM_KEYED_REL), "utf8");
    assert.ok(
      text.includes("Promise<Uint8Array | null | undefined>"),
      "getAccountData must be Promise-typed",
    );
    assert.ok(text.includes("export async function resolveSvmKeyedReads"));
    assert.ok(!text.includes("getAccountData: (account: string) => Uint8Array"));
  });

  it("svm-rpc owns getAccountInfo for product", () => {
    const text = readFileSync(path.join(ROOT, SVM_RPC_REL), "utf8");
    assert.ok(text.includes('"getAccountInfo"'));
    assert.ok(text.includes("fetchProductSvmAccountData"));
    assert.ok(text.includes("createProductSvmKeyedAccountSource"));
    assert.ok(text.includes("account_not_found"));
    assert.ok(text.includes("malformed_response"));
    assert.ok(text.includes("rpc_unavailable"));
  });
});
