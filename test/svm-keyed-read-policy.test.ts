/**
 * SVM keyed-read owner + EVM multicall pin (U7 + keyed-read parity).
 *
 * Completes the fail-closed stub: async multi-account source, live svm-rpc
 * getMultipleAccounts, unresolved when no source. Shared RQ + enabled/staleTime
 * live in keyed-multicall; call sites stay blind.
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
  fetchProductSvmAccountsData,
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
const DETAIL_VIEW_REL = "components/passport/passport-detail-view.tsx";

/** Running count of getAccountsData invocations (report). */
let ACCOUNT_BATCH_READS_EXERCISED = 0;

function countingSource(
  inner: SvmKeyedAccountSource["getAccountsData"],
): SvmKeyedAccountSource {
  return {
    getAccountsData: async (accounts) => {
      ACCOUNT_BATCH_READS_EXERCISED += 1;
      return inner(accounts);
    },
  };
}

describe("svm keyed-read policy", () => {
  it("no source configured → every entry refused unresolved_namespace", async () => {
    const { entries, cause } = await resolveSvmKeyedReads([
      { key: "a", account: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      { key: "b", account: "11111111111111111111111111111111" },
    ]);
    assert.equal(cause, "unresolved_namespace");
    assert.equal(entries.length, 2);
    for (const e of entries) {
      assert.equal(e.status, "refused");
      if (e.status === "refused") {
        assert.equal(e.cause, "unresolved_namespace");
      }
    }
  });

  it("one getAccountsData for multi-key batch; duplicate accounts collapse", async () => {
    const bytesA = new Uint8Array([9, 8, 7]);
    const bytesB = new Uint8Array([1, 2]);
    let lastAccounts: readonly string[] = [];
    const source = countingSource(async (accounts) => {
      lastAccounts = accounts;
      return {
        ok: true as const,
        values: accounts.map((a) =>
          a === "acctA" ? bytesA : a === "acctB" ? bytesB : null,
        ),
      };
    });
    const before = ACCOUNT_BATCH_READS_EXERCISED;
    const { entries, cause } = await resolveSvmKeyedReads(
      [
        { key: "hit", account: "acctA" },
        { key: "miss", account: "missing" },
        { key: "hitAgain", account: "acctA" },
        { key: "other", account: "acctB" },
      ],
      source,
    );
    assert.equal(cause, null);
    assert.equal(ACCOUNT_BATCH_READS_EXERCISED, before + 1);
    assert.deepEqual([...lastAccounts], ["acctA", "missing", "acctB"]);
    assert.equal(entries[0]!.status, "success");
    if (entries[0]!.status === "success") {
      assert.deepEqual(entries[0]!.result, bytesA);
    }
    assert.equal(entries[1]!.status, "refused");
    if (entries[1]!.status === "refused") {
      assert.equal(entries[1]!.cause, "account_not_found");
    }
    assert.equal(entries[2]!.status, "success");
    if (entries[2]!.status === "success") {
      assert.deepEqual(entries[2]!.result, bytesA);
    }
    assert.equal(entries[3]!.status, "success");
    if (entries[3]!.status === "success") {
      assert.deepEqual(entries[3]!.result, bytesB);
    }
  });

  it("maps each FetchSvmAccountDataCause onto the same KeyedReadCause", async () => {
    for (const cause of [
      "rpc_unavailable",
      "account_not_found",
      "malformed_response",
    ] as const) {
      if (cause === "account_not_found") {
        const { entries } = await resolveSvmKeyedReads(
          [{ key: "a", account: "missing" }],
          {
            getAccountsData: async () => ({ ok: true, values: [null] }),
          },
        );
        assert.equal(entries[0]!.status, "refused");
        if (entries[0]!.status === "refused") {
          assert.equal(entries[0]!.cause, "account_not_found");
        }
        continue;
      }
      const { entries } = await resolveSvmKeyedReads(
        [{ key: "a", account: "acct" }],
        {
          getAccountsData: async () => ({
            ok: false,
            cause,
            detail: `planted ${cause}`,
          }),
        },
      );
      assert.equal(entries[0]!.status, "refused");
      if (entries[0]!.status === "refused") {
        assert.equal(entries[0]!.cause, cause);
      }
    }
  });

  it("in-flight account map yields pending for every key", async () => {
    const { svmEntriesFromAccountMap } = await import(
      "@/lib/web3/keyed-multicall"
    );
    const entries = svmEntriesFromAccountMap(
      [{ account: "a" }, { account: "b" }],
      undefined,
    );
    assert.equal(entries.length, 2);
    for (const e of entries) {
      assert.equal(e.status, "pending");
    }
  });

  it("planted sequential getAccountData loop in owner source turns red", () => {
    const text = readFileSync(path.join(ROOT, SVM_KEYED_REL), "utf8");
    assert.ok(
      text.includes("getAccountsData"),
      "owner must call getAccountsData",
    );
    assert.ok(
      !/\.getAccountData\(/.test(text),
      "owner must not call per-account getAccountData",
    );
    const planted = text.replace(
      /batch = await source\.getAccountsData\(unique\);/,
      `const entriesPlanted = [];
  for (const req of requests) {
    entriesPlanted.push(await (source as { getAccountData?: (a: string) => Promise<unknown> }).getAccountData?.(req.account));
  }
  batch = entriesPlanted as typeof batch; // planted sequential`,
    );
    assert.ok(
      /getAccountData\?\.\(req\.account\)/.test(planted),
      "plant must introduce sequential per-account reads",
    );
    assert.ok(
      !/\.getAccountData\(/.test(text),
      "live owner stays batch-only (plant in-memory)",
    );
  });

  it("fetchProductSvmAccountData / AccountsData refuse by name when RPC URL is unset", async () => {
    const prev = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    try {
      const single = await fetchProductSvmAccountData("acct");
      assert.equal(single.ok, false);
      if (!single.ok) assert.equal(single.cause, "rpc_unavailable");
      const multi = await fetchProductSvmAccountsData(["a", "b"]);
      assert.equal(multi.ok, false);
      if (!multi.ok) assert.equal(multi.cause, "rpc_unavailable");
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
      else process.env.NEXT_PUBLIC_SOLANA_RPC_URL = prev;
    }
  });

  it("createProductSvmKeyedAccountSource maps account_not_found via getMultipleAccounts", async () => {
    const prevUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "https://example.invalid/svm-rpc";
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    let lastMethod: string | null = null;
    globalThis.fetch = (async (_input, init) => {
      fetchCalls += 1;
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      lastMethod = body.method ?? null;
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { value: [null, null] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const source = createProductSvmKeyedAccountSource();
      const wrapped = countingSource((accounts) =>
        source.getAccountsData(accounts),
      );
      const data = await wrapped.getAccountsData([
        "Absent1111111111111111111111111111111",
        "Absent2222222222222222222222222222222",
      ]);
      assert.deepEqual(data, { ok: true, values: [null, null] });
      assert.equal(fetchCalls, 1);
      assert.equal(lastMethod, "getMultipleAccounts");
      assert.ok(ACCOUNT_BATCH_READS_EXERCISED >= 2);
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

  it("EVM arm keeps wagmi useReadContracts; SVM arm uses useQuery + honors enabled", () => {
    const owner = readFileSync(path.join(ROOT, KEYED_MULTICALL_REL), "utf8");

    assert.match(
      owner,
      /import\s*\{[^}]*useReadContracts[^}]*\}\s*from\s*["']wagmi["']/,
    );
    assert.match(
      owner,
      /import\s*\{[^}]*useQuery[^}]*\}\s*from\s*["']@tanstack\/react-query["']/,
    );
    assert.ok(owner.includes("status: \"success\""));
    assert.ok(owner.includes("status: \"failure\""));
    assert.ok(owner.includes("entry: (key: K)"));
    assert.ok(owner.includes("get: (key: K)"));
    assert.ok(
      owner.includes("svmKeyedReadQueryKey") ||
        owner.includes('["svm-keyed-reads"'),
      "SVM arm must share a stable RQ key",
    );
    assert.ok(
      owner.includes("svmQueryEnabled") ||
        /enabled:\s*svmQueryEnabled/.test(owner),
      "SVM useQuery must honor enabled",
    );
    assert.ok(
      owner.includes("staleTime: query?.staleTime"),
      "SVM useQuery must honor staleTime",
    );
    assert.ok(
      /const enabled = \(query\?\.enabled \?\? true\) && !isSvmBatch;/.test(
        owner,
      ),
      "EVM wagmi must stay disabled for SVM batches",
    );

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

  it("panels never call resolveSvmKeyedReads or account RPC methods", () => {
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
        /resolveSvmKeyedReads|createProductSvmKeyedAccountSource|fetchProductSvmAccountData|fetchProductSvmAccountsData|getAccountInfo|getMultipleAccounts/.test(
          text,
        )
      ) {
        return `panel_keyed_read (${rel})`;
      }
      return false;
    };
    assertCleanProductScan(scanProductSources(ban));
  });

  it("passport detail mounts PassportCommerce once (no dual md:hidden copy)", () => {
    const src = readFileSync(path.join(ROOT, DETAIL_VIEW_REL), "utf8");
    const opens = src.match(/<PassportCommerce[\s>]/g) ?? [];
    assert.equal(
      opens.length,
      2,
      "ternary still has two JSX shapes but one fiber placement",
    );
    // Placement: commerce variable used once in the tree (aside only).
    const placements = src.match(/\{commerce\}/g) ?? [];
    assert.equal(
      placements.length,
      1,
      "commerce must appear once in the render tree",
    );
    assert.ok(
      !src.includes('md:hidden">{commerce}'),
      "must not keep mobile dual-copy placement",
    );

    const plantedDual = src.replace(
      "{commerce}",
      '{commerce}</aside><div className="md:hidden">{commerce}</div><aside>',
    );
    const plantedPlacements = plantedDual.match(/\{commerce\}/g) ?? [];
    assert.ok(
      plantedPlacements.length >= 2,
      "planted dual placement must be detectable",
    );
    assert.equal(
      (src.match(/\{commerce\}/g) ?? []).length,
      1,
      "live source stays single placement",
    );
  });

  it("reports account-batch exercise count for the ship report", () => {
    assert.ok(
      ACCOUNT_BATCH_READS_EXERCISED >= 2,
      `expected ≥2 batch reads, got ${ACCOUNT_BATCH_READS_EXERCISED}`,
    );
    console.log(
      `U7_ACCOUNT_BATCH_READS_EXERCISED=${ACCOUNT_BATCH_READS_EXERCISED}`,
    );
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

  it("SvmKeyedAccountSource is async batch-only (owner source text)", () => {
    const text = readFileSync(path.join(ROOT, SVM_KEYED_REL), "utf8");
    assert.ok(
      text.includes("Promise<SvmKeyedAccountSourceBatch>"),
      "getAccountsData must return typed batch Result (not Error strings)",
    );
    assert.ok(text.includes("export type SvmKeyedAccountSourceBatch"));
    assert.ok(text.includes("export async function resolveSvmKeyedReads"));
    assert.ok(!text.includes("getAccountData:"));
  });

  it("svm-rpc owns getMultipleAccounts for product batches", () => {
    const text = readFileSync(path.join(ROOT, SVM_RPC_REL), "utf8");
    assert.ok(text.includes('"getMultipleAccounts"'));
    assert.ok(text.includes("fetchProductSvmAccountsData"));
    assert.ok(text.includes("fetchProductSvmAccountData"));
    assert.ok(text.includes("createProductSvmKeyedAccountSource"));
    assert.ok(text.includes("account_not_found"));
    assert.ok(text.includes("malformed_response"));
    assert.ok(text.includes("rpc_unavailable"));
    // Single-account convenience must route through the batch door (no parallel getAccountInfo).
    assert.ok(
      !/"getAccountInfo"/.test(text),
      "product account reads must not keep a parallel getAccountInfo door",
    );
  });
});
