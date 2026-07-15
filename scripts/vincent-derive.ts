/**
 * F-1 Vincent Commons derivation CLI (docs/research/vincent-flywheel.md §4.2).
 *
 * Reads VERIFIED passports from the Ponder HTTP API, fetches full metadata
 * JSON from each tokenUri (engine/modelVariant are not in the Ponder table),
 * derives Vincent claim fact cores via the pure module, and writes
 * `claims.jsonl` (JCS-canonical, one fact core per line) + `report.json`.
 *
 * Usage:
 *   node --import tsx scripts/vincent-derive.ts \
 *     [--ponder-url https://ponder.kargain.com] \
 *     [--out .vincent-commons] \
 *     [--baseline path/to/published-epoch.jsonl] \
 *     [--cross-check]
 *
 * All network access lives here; lib/vincent-commons stays pure.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { validateVin, vinRegion } from "@kargain/vincent";
import { createArweaveGetLeaf } from "@kargain/vincent/arweave";
import { createDecoder } from "@kargain/vincent/decoder";
import {
  canonicalize,
  claimHash,
  parseClaim,
  type Claim,
} from "@kargain/vincent/protocol";

import { parseMetadataJson } from "../lib/passport/parse-metadata-json.js";
import { VINCENT_DATASET } from "../lib/passport/vincent-dataset.js";
import { arUriToHttp } from "../lib/storage/ar-gateway.js";
import {
  deriveClaims,
  VPIC_CANONICAL_CODES,
  type DerivedAttribute,
  type VincentObservation,
} from "../lib/vincent-commons/derive-claims.js";

const DEFAULT_PONDER_URL = "https://ponder.kargain.com";
const DEFAULT_OUT_DIR = ".vincent-commons";
const PAGE_LIMIT = 100;

type PonderPassportRow = {
  id: string;
  status: string;
  tokenUri: string;
  vin: string;
  make: string;
  model: string;
  year: number;
};

type PassportsPage = {
  passports: PonderPassportRow[];
  total: number;
  page: number;
  limit: number;
};

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  }
  return res.json();
}

async function fetchVerifiedPassports(
  ponderUrl: string,
): Promise<PonderPassportRow[]> {
  const rows: PonderPassportRow[] = [];
  let page = 1;
  for (;;) {
    const url = `${ponderUrl}/passports?status=VERIFIED&verifiedFirst=false&page=${page}&limit=${PAGE_LIMIT}`;
    const body = (await fetchJson(url)) as PassportsPage;
    rows.push(...body.passports);
    if (rows.length >= body.total || body.passports.length === 0) break;
    page += 1;
  }
  return rows;
}

type MetadataFailure = { tokenId: string; reason: string };

async function buildObservations(rows: PonderPassportRow[]): Promise<{
  observations: VincentObservation[];
  metadataFailures: MetadataFailure[];
}> {
  const observations: VincentObservation[] = [];
  const metadataFailures: MetadataFailure[] = [];

  for (const row of rows) {
    const url = arUriToHttp(row.tokenUri);
    if (!url) {
      metadataFailures.push({ tokenId: row.id, reason: "unsupported-token-uri" });
      continue;
    }
    let metadata: ReturnType<typeof parseMetadataJson>;
    try {
      metadata = parseMetadataJson(await fetchJson(url));
    } catch {
      metadataFailures.push({ tokenId: row.id, reason: "metadata-fetch-failed" });
      continue;
    }
    if (!metadata) {
      metadataFailures.push({ tokenId: row.id, reason: "metadata-parse-failed" });
      continue;
    }
    observations.push({
      tokenId: row.id,
      vin: metadata.vin || row.vin,
      year: metadata.year ?? row.year,
      make: metadata.make || row.make || undefined,
      model: metadata.model || row.model || undefined,
      modelVariant: metadata.modelVariant,
      bodyType: metadata.bodyType,
      fuelType: metadata.fuelType,
      transmission: metadata.transmission,
      engine: metadata.engine,
    });
  }

  return { observations, metadataFailures };
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

type CrossCheckMismatch = {
  tokenId: string;
  attribute: DerivedAttribute;
  observed: string;
  decoded: string;
};

type CrossCheckResult = {
  checked: number;
  mismatches: CrossCheckMismatch[];
  errors: Array<{ tokenId: string; error: string }>;
};

function observedCanonicalAttributes(
  obs: VincentObservation,
): Array<{ attribute: DerivedAttribute; code: string }> {
  const out: Array<{ attribute: DerivedAttribute; code: string }> = [];
  const model = obs.model?.trim();
  if (model) out.push({ attribute: "model", code: model });
  const series = obs.modelVariant?.trim();
  if (series) out.push({ attribute: "series", code: series });
  const engine = obs.engine?.trim();
  if (engine) out.push({ attribute: "engine", code: engine });

  const fuel = obs.fuelType?.trim();
  const fuelCode = fuel
    ? VPIC_CANONICAL_CODES.fuelType[fuel as keyof typeof VPIC_CANONICAL_CODES.fuelType]
    : undefined;
  if (fuelCode) out.push({ attribute: "fuelType", code: fuelCode });

  const body = obs.bodyType?.trim();
  const bodyCode = body
    ? VPIC_CANONICAL_CODES.bodyType[body as keyof typeof VPIC_CANONICAL_CODES.bodyType]
    : undefined;
  if (bodyCode) out.push({ attribute: "bodyType", code: bodyCode });

  const trans = obs.transmission?.trim();
  const transCode = trans
    ? VPIC_CANONICAL_CODES.transmission[
        trans as keyof typeof VPIC_CANONICAL_CODES.transmission
      ]
    : undefined;
  if (transCode) out.push({ attribute: "transmission", code: transCode });

  return out;
}

/** Decode NA-region VINs against the pinned dataset; report attribute drift. */
async function crossCheck(
  observations: VincentObservation[],
): Promise<CrossCheckResult> {
  const getLeaf = createArweaveGetLeaf({
    gatewayUrl: VINCENT_DATASET.gatewayUrl,
    graphqlUrl: VINCENT_DATASET.graphqlUrl,
    publisher: VINCENT_DATASET.publisher,
    epoch: Number(VINCENT_DATASET.arweaveEpochTag),
  });
  const decoder = createDecoder({
    merkleRoot: VINCENT_DATASET.merkleRoot,
    getLeaf,
  });

  const result: CrossCheckResult = { checked: 0, mismatches: [], errors: [] };

  for (const obs of observations) {
    const validation = validateVin(obs.vin);
    if (validation.length !== 17 || !validation.ok) continue;
    if (vinRegion(validation.normalized[0] ?? "") !== "north-america") continue;

    result.checked += 1;
    try {
      const decoded = await decoder.decode(validation.normalized, {
        year: obs.year,
      });
      const decodedByAttribute = new Map<string, string>();
      for (const attr of decoded.attributes) {
        if (attr.value != null && !attr.ambiguous) {
          decodedByAttribute.set(attr.attribute, attr.value.trim());
        }
      }
      for (const { attribute, code } of observedCanonicalAttributes(obs)) {
        const decodedValue = decodedByAttribute.get(attribute);
        if (decodedValue === undefined) continue;
        if (decodedValue.toLowerCase() !== code.toLowerCase()) {
          result.mismatches.push({
            tokenId: obs.tokenId,
            attribute,
            observed: code,
            decoded: decodedValue,
          });
        }
      }
    } catch (error) {
      result.errors.push({
        tokenId: obs.tokenId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

function countByType(claims: readonly Claim[]) {
  const counts = { vdsSchema: 0, vdsBinding: 0, vdsPattern: 0 };
  for (const claim of claims) {
    if (claim.type === "vds-schema") counts.vdsSchema += 1;
    else if (claim.type === "vds-binding") counts.vdsBinding += 1;
    else if (claim.type === "vds-pattern") counts.vdsPattern += 1;
  }
  return { ...counts, total: claims.length };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "ponder-url": { type: "string", default: DEFAULT_PONDER_URL },
      out: { type: "string", default: DEFAULT_OUT_DIR },
      baseline: { type: "string" },
      "cross-check": { type: "boolean", default: false },
    },
  });

  const ponderUrl = (values["ponder-url"] ?? DEFAULT_PONDER_URL).replace(/\/$/, "");
  const outDir = values.out ?? DEFAULT_OUT_DIR;

  console.log(`Fetching VERIFIED passports from ${ponderUrl} …`);
  const rows = await fetchVerifiedPassports(ponderUrl);
  console.log(`  ${rows.length} VERIFIED passports`);

  const { observations, metadataFailures } = await buildObservations(rows);
  console.log(
    `  ${observations.length} observations (${metadataFailures.length} metadata failures)`,
  );

  const { claims, report, sources } = await deriveClaims(observations);

  let outputClaims = claims;
  let baseline: { path: string; published: number; subtracted: number } | null =
    null;
  if (values.baseline) {
    const baselineHashes = loadBaselineHashes(values.baseline);
    outputClaims = claims.filter(
      (claim) => !baselineHashes.has(claimHash(claim)),
    );
    baseline = {
      path: values.baseline,
      published: baselineHashes.size,
      subtracted: claims.length - outputClaims.length,
    };
  }

  let crossCheckResult: CrossCheckResult | null = null;
  if (values["cross-check"]) {
    console.log("Cross-checking NA VINs against the pinned dataset …");
    crossCheckResult = await crossCheck(observations);
    console.log(
      `  checked ${crossCheckResult.checked}, mismatches ${crossCheckResult.mismatches.length}, errors ${crossCheckResult.errors.length}`,
    );
  }

  mkdirSync(outDir, { recursive: true });

  const jsonlPath = join(outDir, "claims.jsonl");
  const jsonl = outputClaims.map((claim) => canonicalize(claim)).join("\n");
  writeFileSync(jsonlPath, jsonl.length > 0 ? `${jsonl}\n` : "");

  const reportPath = join(outDir, "report.json");
  const fullReport = {
    generatedFrom: {
      ponderUrl,
      verifiedPassports: rows.length,
      metadataFailures,
    },
    derivation: { ...report, sources },
    baseline,
    crossCheck: crossCheckResult,
    output: countByType(outputClaims),
  };
  writeFileSync(reportPath, `${JSON.stringify(fullReport, null, 2)}\n`);

  console.log(`Wrote ${outputClaims.length} claims to ${jsonlPath}`);
  console.log(`Wrote report to ${reportPath}`);
  if (report.conflicts.length > 0) {
    console.log(`  conflicts: ${report.conflicts.length} (excluded from claims)`);
  }
  if (report.unknownWmiCandidates.length > 0) {
    console.log(
      `  unknown WMIs (document-required candidates): ${report.unknownWmiCandidates.length}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
