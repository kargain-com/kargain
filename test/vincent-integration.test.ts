/**
 * Vincent 0.8.0 surface + Merkle inclusion proofs.
 *
 * Offline cases synthesize a JCS leaf and RFC 6962–style Merkle proof (same
 * domain separation as `@kargain/vincent/decoder` verifyLeaf).
 *
 * Live cases against the pinned Sepolia Irys dataset require:
 *   VINCENT_LIVE=1 node --import tsx --test test/vincent-integration.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalize, sha256Hex } from "@kargain/vincent/protocol";
import {
  createDecoder,
  matchExpression,
  verifyLeaf,
  type GetLeaf,
  type MerkleProof,
} from "@kargain/vincent/decoder";
import { LeafNotFoundError, createArweaveGetLeaf } from "@kargain/vincent/arweave";
import { validateVin, decodeModelYear, normalizeVin } from "@kargain/vincent";
import { lookupWmi } from "@kargain/vincent/wmi";

import {
  clearVinDecodeCacheForTests,
  decodeVinFields,
} from "../lib/passport/vin-decode.ts";
import { VINCENT_DATASET } from "../lib/passport/vincent-dataset.ts";

const vincentPkg = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../node_modules/@kargain/vincent/package.json",
    ),
    "utf8",
  ),
) as { version: string };

const LIVE = process.env.VINCENT_LIVE === "1";

const NA_VIN = "1HGBH41JXMN109186"; // WMI 1HG, year best 1991
const LIVE_VIN = "10RL00002LA123456"; // WMI 10R in Sepolia validation epoch

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function formatDigest(bytes: Uint8Array): string {
  return `sha256:${bytesToHex(bytes)}`;
}

function hashLeafNode(rawDigest: Uint8Array): Uint8Array {
  const input = new Uint8Array(1 + rawDigest.length);
  input[0] = 0x00;
  input.set(rawDigest, 1);
  return hexToBytes(sha256Hex(input));
}

function hashInternalNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  const input = new Uint8Array(1 + left.length + right.length);
  input[0] = 0x01;
  input.set(left, 1);
  input.set(right, 1 + left.length);
  return hexToBytes(sha256Hex(input));
}

/** Minimal valid decode leaf for Honda WMI 1HG, patterns match any VDS. */
function buildSyntheticHondaLeaf(): {
  leaf: string;
  proof: MerkleProof;
  merkleRoot: string;
} {
  const leafObj = {
    wmi: "1HG",
    bindings: [{ yearFrom: 1991, yearTo: 1991, schemaRef: "s1" }],
    schemas: {
      s1: {
        patterns: [
          { match: { vds: "*****" }, attribute: "model", code: "Civic" },
          { match: { vds: "*****" }, attribute: "series", code: "EX" },
          { match: { vds: "*****" }, attribute: "fuelType", code: "Gasoline" },
          {
            match: { vds: "*****" },
            attribute: "bodyType",
            code: "Sedan/Saloon",
          },
          {
            match: { vds: "*****" },
            attribute: "transmission",
            code: "Automatic",
          },
          { match: { vds: "*****" }, attribute: "engine", code: "1.5L I4" },
        ],
      },
    },
  };

  const leaf = canonicalize(leafObj);
  const leafHashHex = sha256Hex(utf8(leaf));
  const sibling = hexToBytes("11".repeat(32));
  const leafNode = hashLeafNode(hexToBytes(leafHashHex));
  // Leaf on the left → sibling is on the right of the path node
  const rootNode = hashInternalNode(leafNode, sibling);
  const merkleRoot = formatDigest(rootNode);
  const proof: MerkleProof = [{ hash: formatDigest(sibling), side: "right" }];
  return { leaf, proof, merkleRoot };
}

describe("@kargain/vincent 0.8.0 package surfaces", () => {
  it("resolves installed version 0.8.0", () => {
    assert.equal(vincentPkg.version, "0.8.0");
  });

  it("main entry: normalizeVin + validateVin + decodeModelYear", () => {
    assert.equal(normalizeVin(" 1hg "), "1HG");
    const validation = validateVin(NA_VIN);
    assert.equal(validation.ok, true);
    assert.equal(validation.region, "north-america");
    assert.equal(validation.errors.length, 0);
    const year = decodeModelYear(NA_VIN);
    assert.equal(year.best, 1991);
  });

  it("./wmi: lookupWmi resolves Honda manufacturer", async () => {
    const wmi = await lookupWmi(NA_VIN);
    assert.ok(wmi);
    assert.equal(wmi?.wmi, "1HG");
    assert.match(wmi?.manufacturer ?? "", /HONDA/i);
  });

  it("./decoder + ./arweave export callable constructors / errors", () => {
    assert.equal(typeof createDecoder, "function");
    assert.equal(typeof verifyLeaf, "function");
    assert.equal(typeof matchExpression, "function");
    assert.equal(typeof createArweaveGetLeaf, "function");
    assert.ok(LeafNotFoundError.prototype instanceof Error);
    assert.equal(matchExpression({ vds: "*****" }, NA_VIN), true);
  });
});

describe("Merkle branch verification (offline synthetic)", () => {
  const { leaf, proof, merkleRoot } = buildSyntheticHondaLeaf();

  it("verifyLeaf accepts a leaf whose proof folds to the merkle root", () => {
    const result = verifyLeaf(leaf, proof, merkleRoot);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.leaf.wmi, "1HG");
      assert.match(result.leafHash, /^sha256:[0-9a-f]{64}$/);
    }
  });

  it("verifyLeaf rejects a wrong merkle root (proof does not fold to it)", () => {
    const result = verifyLeaf(leaf, proof, `sha256:${"00".repeat(32)}`);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "proof-invalid");
    }
  });

  it("verifyLeaf rejects a tampered Merkle sibling", () => {
    const tampered: MerkleProof = [
      { hash: `sha256:${"22".repeat(32)}`, side: "right" },
    ];
    const result = verifyLeaf(leaf, tampered, merkleRoot);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "proof-invalid");
    }
  });

  it("createDecoder verifies each getLeaf payload before decoding attributes", async () => {
    let getLeafCalls = 0;
    const getLeaf: GetLeaf = async (key) => {
      getLeafCalls += 1;
      assert.equal(key, "1HG");
      return { leaf, proof };
    };

    const good = createDecoder({ merkleRoot, getLeaf });
    const decoded = await good.decode(NA_VIN, { year: 1991 });
    assert.equal(decoded.valid, true);
    assert.equal(decoded.errors.length, 0);
    assert.equal(getLeafCalls, 1);
    const byAttr = Object.fromEntries(
      decoded.attributes.map((a) => [a.attribute, a.value]),
    );
    assert.equal(byAttr.model, "Civic");
    assert.equal(byAttr.fuelType, "Gasoline");
    assert.equal(byAttr.bodyType, "Sedan/Saloon");

    // Wrong anchored root → decoder surfaces proof-invalid (Merkle gate)
    const bad = createDecoder({
      merkleRoot: `sha256:${"00".repeat(32)}`,
      getLeaf,
    });
    const rejected = await bad.decode(NA_VIN, { year: 1991 });
    assert.ok(
      rejected.errors.some((e) => e.code === "proof-invalid"),
      `expected proof-invalid, got ${JSON.stringify(rejected.errors)}`,
    );
    assert.equal(rejected.attributes.length, 0);
  });

  it("decodeVinFields maps Merkle-verified attributes via createDecoder", async () => {
    clearVinDecodeCacheForTests();
    const getLeaf: GetLeaf = async () => ({ leaf, proof });
    const decoder = createDecoder({ merkleRoot, getLeaf });

    const fields = await decodeVinFields(NA_VIN, 1991, {
      decode: (vin, options) => decoder.decode(vin, options),
    });

    assert.deepEqual(fields, {
      model: "Civic",
      modelVariant: "EX",
      fuelType: "Petrol",
      bodyType: "Sedan",
      transmission: "Automatic",
      engine: "1.5L I4",
    });
  });
});

describe(
  "Vincent Sepolia live dataset (VINCENT_LIVE=1)",
  { skip: !LIVE },
  () => {
    it("createArweaveGetLeaf + verifyLeaf against pinned VINCENT_DATASET merkleRoot", async () => {
      const getLeaf = createArweaveGetLeaf({
        gatewayUrl: VINCENT_DATASET.gatewayUrl,
        graphqlUrl: VINCENT_DATASET.graphqlUrl,
        publisher: VINCENT_DATASET.publisher,
        epoch: Number(VINCENT_DATASET.arweaveEpochTag),
      });

      const payload = await getLeaf("10R");
      assert.ok(typeof payload.leaf === "string" || payload.leaf instanceof Uint8Array);
      assert.ok(Array.isArray(payload.proof));
      assert.ok(payload.proof.length > 0);

      const verified = verifyLeaf(
        payload.leaf,
        payload.proof,
        VINCENT_DATASET.merkleRoot,
      );
      assert.equal(
        verified.ok,
        true,
        !verified.ok ? `${verified.code}: ${verified.reason}` : undefined,
      );
      if (verified.ok) {
        assert.equal(verified.leaf.wmi, "10R");
      }

      // Wrong root must fail against the same fetched proof branch
      const wrongRoot = verifyLeaf(
        payload.leaf,
        payload.proof,
        `sha256:${"00".repeat(32)}`,
      );
      assert.equal(wrongRoot.ok, false);
    });

    it("createDecoder end-to-end decode uses Irys leaf + Merkle gate", async () => {
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

      const result = await decoder.decode(LIVE_VIN, { year: 1990 });
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
      assert.ok(result.attributes.some((a) => a.attribute === "model" && a.value));
    });

    it("decodeVinFields default path (live Arweave) returns mapped fields", async () => {
      clearVinDecodeCacheForTests();
      // Force a unique cache key by year hint; exercises getDefaultDecode → Arweave
      const fields = await decodeVinFields(LIVE_VIN, 1990);
      assert.ok(fields);
      assert.ok(fields?.model);
    });
  },
);
