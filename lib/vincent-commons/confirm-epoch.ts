/**
 * F-3c pure rebuild gate (docs/research/vincent-flywheel.md §4.4).
 *
 * Verifies a published epoch end-to-end against its on-chain anchor tuple:
 * manifest integrity (hash + publisher signature), anchor↔manifest dataset
 * cross-checks, dataset JSONL byte hash, then a full compiler rebuild via
 * `@kargain/vincent-compiler` `verifyEpoch`. Only a fully green result may
 * back a `rebuilt` confirmation — callers must never sign on failure.
 *
 * Bundle isolation: this module is the only lib importer of
 * `@kargain/vincent-compiler` and is reachable solely from
 * scripts/vincent-confirm.ts and tests — never from app code.
 */
import { verifyEpoch } from "@kargain/vincent-compiler";
import {
  manifestHash,
  parseClaim,
  parseManifest,
  sha256Hex,
  verifyManifest,
  type Claim,
  type Manifest,
} from "@kargain/vincent/protocol";

/** On-chain epoch tuple fields relevant to the rebuild gate (AnchorEpoch subset). */
export type RebuildAnchorTuple = {
  manifestHash: string;
  jsonlSha256: string;
  merkleRoot: string;
};

export type RebuildFailure = {
  check:
    | "manifest-parse"
    | "manifest-hash"
    | "manifest-signature"
    | "anchor-jsonl-sha256"
    | "anchor-merkle-root"
    | "dataset-jsonl-sha256"
    | "jsonl-claim-parse"
    | "rebuild";
  expected?: string;
  got?: string;
};

export type VerifyEpochRebuildResult =
  | { ok: true; manifest: Manifest; claims: Claim[] }
  | { ok: false; failures: RebuildFailure[] };

export type VerifyEpochRebuildInput = {
  anchor: RebuildAnchorTuple;
  /** Manifest JSON as fetched from `manifestUri` (unparsed). */
  manifestJson: unknown;
  /** Dataset JSONL text as fetched from `manifest.dataset.uris`. */
  jsonlText: string;
};

function contentIdFromUtf8(text: string): string {
  return `sha256:${sha256Hex(new TextEncoder().encode(text))}`;
}

/**
 * Sync, no I/O. Fails closed with every determinable mismatch listed —
 * the CLI prints `expected` / `got` hashes verbatim.
 */
export function verifyEpochRebuild(
  input: VerifyEpochRebuildInput,
): VerifyEpochRebuildResult {
  const { anchor, manifestJson, jsonlText } = input;

  const parsed = parseManifest(manifestJson);
  if (!parsed.ok) {
    return {
      ok: false,
      failures: [
        {
          check: "manifest-parse",
          got: `${parsed.error.code}: ${parsed.error.message}`,
        },
      ],
    };
  }
  const manifest = parsed.value;

  const failures: RebuildFailure[] = [];

  const computedManifestHash = manifestHash(manifest);
  if (computedManifestHash !== anchor.manifestHash) {
    failures.push({
      check: "manifest-hash",
      expected: anchor.manifestHash,
      got: computedManifestHash,
    });
  }

  const signature = verifyManifest(manifest);
  if (!signature.ok) {
    failures.push({ check: "manifest-signature", got: signature.reason });
  }

  if (manifest.dataset.jsonlSha256 !== anchor.jsonlSha256) {
    failures.push({
      check: "anchor-jsonl-sha256",
      expected: anchor.jsonlSha256,
      got: manifest.dataset.jsonlSha256,
    });
  }
  if (manifest.dataset.merkleRoot !== anchor.merkleRoot) {
    failures.push({
      check: "anchor-merkle-root",
      expected: anchor.merkleRoot,
      got: manifest.dataset.merkleRoot,
    });
  }

  const jsonlContentId = contentIdFromUtf8(jsonlText);
  if (jsonlContentId !== manifest.dataset.jsonlSha256) {
    failures.push({
      check: "dataset-jsonl-sha256",
      expected: manifest.dataset.jsonlSha256,
      got: jsonlContentId,
    });
  }

  if (failures.length > 0) return { ok: false, failures };

  const claims: Claim[] = [];
  const lines = jsonlText.split("\n");
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return {
        ok: false,
        failures: [
          { check: "jsonl-claim-parse", got: `line ${index + 1}: invalid JSON` },
        ],
      };
    }
    const claim = parseClaim(json);
    if (!claim.ok) {
      return {
        ok: false,
        failures: [
          {
            check: "jsonl-claim-parse",
            got: `line ${index + 1}: ${claim.error.code}: ${claim.error.message}`,
          },
        ],
      };
    }
    claims.push(claim.value);
  }

  const rebuilt = verifyEpoch(manifest, claims);
  if (!rebuilt.ok) {
    return { ok: false, failures: [{ check: "rebuild", got: rebuilt.reason }] };
  }

  return { ok: true, manifest, claims };
}
