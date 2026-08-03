/**
 * F-3a Vincent Commons batch assembler CLI (docs/research/vincent-flywheel.md
 * §4.3–§4.4, §10.1 F-3a refinement). Usable by any active verifier.
 *
 * Reads VERIFIED observations from the Ponder HTTP API, the shared review
 * pool (kinds 31860/31861) from the Nostr relay set, snapshots
 * `isActiveVerifier` per attester via a viem read, and writes the assembly
 * outputs — the pure pipeline lives in lib/vincent-commons/assemble.ts.
 *
 * Usage:
 *   node --import tsx scripts/vincent-assemble.ts \
 *     [--ponder-url https://ponder.kargain.com] \
 *     [--relays wss://a,wss://b] \
 *     [--out .vincent-commons/assembly] \
 *     [--baseline path/to/published-epoch.jsonl] \
 *     [--window-days 14] \
 *     [--now 2026-07-15T00:00:00Z] \
 *     [--rpc-url https://sepolia.base.org]
 *
 * Outputs to --out:
 *   accepted-community-claims.jsonl   fact cores, §7.2 order, baseline subtracted
 *   attestation-archive.json          claimHash → signed reviews + proposal events
 *   assembly-report.json              counts + excluded-with-reasons
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { SimplePool, type Event, type Filter } from "nostr-tools";
import { createPublicClient, http, type Address } from "viem";
import { baseSepolia } from "viem/chains";

import { claimHash, parseClaim } from "@kargain/vincent/protocol";

import { KarProStakingAbi } from "../lib/contracts/abis.generated.js";
import { NOSTR_RELAYS } from "../lib/nostr/relays.js";
import { attestedPubkeysForAddresses } from "../lib/nostr/resolve-attested-profile.js";
import {
  assembleCommunityBatch,
  serializeAssemblyReport,
  serializeAttestationArchive,
  serializeClaimsJsonl,
} from "../lib/vincent-commons/assemble.js";
import { fetchVerifiedObservations } from "../lib/vincent-commons/observations-source.js";
import {
  SEPOLIA_ACTIVE,
  SEPOLIA_PUBLIC_RPC,
} from "../lib/web3/sepolia-addresses.js";

const DEFAULT_PONDER_URL = "https://ponder.kargain.com";
const DEFAULT_OUT_DIR = ".vincent-commons/assembly";
const DEFAULT_WINDOW_DAYS = 14;
const PAGE_LIMIT = 100;
const RELAY_QUERY_MAX_WAIT_MS = 5000;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  }
  return res.json();
}

function loadBaselineHashes(path: string): Set<string> {
  const hashes = new Set<string>();
  const lines = readFileSync(path, "utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      throw new Error(`baseline line ${index + 1} is not valid JSON`);
    }
    const parsed = parseClaim(json);
    if (!parsed.ok) {
      throw new Error(
        `baseline line ${index + 1} is not a valid claim (${parsed.error.code}): ${parsed.error.message}`,
      );
    }
    hashes.add(claimHash(parsed.value));
  }
  return hashes;
}

function parseNowSeconds(iso: string | undefined): number {
  if (!iso) return Math.floor(Date.now() / 1000);
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`--now is not a valid ISO timestamp: ${iso}`);
  }
  return Math.floor(ms / 1000);
}

function parseWindowDays(raw: string | undefined): number {
  if (!raw) return DEFAULT_WINDOW_DAYS;
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 0) {
    throw new Error(`--window-days must be a non-negative number: ${raw}`);
  }
  return days;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "ponder-url": { type: "string", default: DEFAULT_PONDER_URL },
      relays: { type: "string" },
      out: { type: "string", default: DEFAULT_OUT_DIR },
      baseline: { type: "string" },
      "window-days": { type: "string" },
      now: { type: "string" },
      "rpc-url": { type: "string", default: SEPOLIA_PUBLIC_RPC },
    },
  });

  const ponderUrl = (values["ponder-url"] ?? DEFAULT_PONDER_URL).replace(/\/$/, "");
  const outDir = values.out ?? DEFAULT_OUT_DIR;
  const relays = values.relays
    ? values.relays.split(",").map((r) => r.trim()).filter(Boolean)
    : [...NOSTR_RELAYS];
  const windowDays = parseWindowDays(values["window-days"]);
  const nowSeconds = parseNowSeconds(values.now);
  const rpcUrl = values["rpc-url"] ?? SEPOLIA_PUBLIC_RPC;
  const baselineHashes = values.baseline
    ? loadBaselineHashes(values.baseline)
    : new Set<string>();

  console.log(`Fetching VERIFIED passports from ${ponderUrl} …`);
  const { observations, verifierByTokenId, metadataFailures } =
    await fetchVerifiedObservations({
      ponderUrl,
      fetchJson,
      pageLimit: PAGE_LIMIT,
    });
  console.log(
    `  ${observations.length} observations (${metadataFailures.length} metadata failures)`,
  );

  const pool = new SimplePool();
  const queryEvents = (filter: Filter): Promise<Event[]> =>
    pool.querySync(relays, filter, { maxWait: RELAY_QUERY_MAX_WAIT_MS });

  // Gate 1 — attested kind 0 pubkey per attester (coverage via SimplePool.ensureRelay).
  const attestedPubkeys = (addresses: string[]): Promise<Map<string, string | null>> =>
    attestedPubkeysForAddresses(addresses as Address[], { pool });

  // Gate 2 — isActiveVerifier snapshot at assembly time (multicall-batched).
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
    batch: { multicall: true },
  });
  const stakingAddress = SEPOLIA_ACTIVE.karProStaking as Address;
  const isActiveVerifier = async (
    addresses: string[],
  ): Promise<Map<string, boolean>> => {
    const results = await Promise.all(
      addresses.map((address) =>
        publicClient.readContract({
          address: stakingAddress,
          abi: KarProStakingAbi,
          functionName: "isActiveVerifier",
          args: [address as Address],
        }),
      ),
    );
    return new Map(addresses.map((address, i) => [address, results[i] === true]));
  };

  console.log(
    `Assembling (window ${windowDays}d, now ${new Date(nowSeconds * 1000).toISOString()}) …`,
  );
  try {
    const { acceptedClaims, archive, report } = await assembleCommunityBatch({
      observations,
      verifierByTokenId,
      nowSeconds,
      windowDays,
      baselineHashes,
      deps: { queryEvents, attestedPubkeys, isActiveVerifier },
    });

    mkdirSync(outDir, { recursive: true });

    const jsonlPath = join(outDir, "accepted-community-claims.jsonl");
    writeFileSync(jsonlPath, serializeClaimsJsonl(acceptedClaims));

    const archivePath = join(outDir, "attestation-archive.json");
    writeFileSync(archivePath, serializeAttestationArchive(archive));

    const reportPath = join(outDir, "assembly-report.json");
    writeFileSync(reportPath, serializeAssemblyReport(report));

    console.log(`Wrote ${acceptedClaims.length} accepted claims to ${jsonlPath}`);
    console.log(`Wrote attestation archive to ${archivePath}`);
    console.log(`Wrote report to ${reportPath}`);
    console.log(
      `  accepted ${report.counts.accepted.total} (patterns ${report.counts.accepted.vdsPattern}, wmi ${report.counts.accepted.wmi})` +
        ` · excluded ${report.excluded.length} · conflicts ${report.conflicts.length}` +
        (report.baseline.published > 0
          ? ` · baseline subtracted ${report.baseline.subtracted}`
          : ""),
    );
    for (const exclusion of report.excluded) {
      if (exclusion.reason === "in-window") {
        console.log(
          `  in-window: ${exclusion.claimHash} (${exclusion.remainingSeconds}s remaining)`,
        );
      }
    }
  } finally {
    pool.close(relays);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
