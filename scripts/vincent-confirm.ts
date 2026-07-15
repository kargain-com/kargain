/**
 * F-3c Vincent Commons epoch confirmation CLI (docs/research/vincent-flywheel.md
 * §4.4, PROTOCOL §6 ManifestAttestation). Usable by any active verifier.
 *
 * Reads one epoch from VincentAnchorRegistry, fetches its manifest and dataset
 * JSONL, verifies manifest hash + publisher signature + dataset hashes, and
 * rebuilds the epoch byte-for-byte via @kargain/vincent-compiler. Only a fully
 * green rebuild is signed as a `rebuilt` confirmation (kind 31862, d =
 * manifestHash) with the verifier's wallet key — any mismatch is a hard FAIL
 * with the differing hashes printed, and nothing is ever signed.
 *
 * Usage:
 *   node --import tsx scripts/vincent-confirm.ts \
 *     --publisher 0x… --index 0 \
 *     [--rpc-url https://sepolia.base.org] \
 *     [--relays wss://a,wss://b] \
 *     [--gateway https://testnet-gateway.irys.xyz] \
 *     [--dry-run]
 *
 * Signing key: VINCENT_CONFIRMER_PRIVATE_KEY in .env.local (never logged).
 * --dry-run prints PASS/FAIL and the unsigned document; no key, no publish.
 */
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";

import { config as loadEnv } from "dotenv";
import { hexToBytes } from "viem";
import { finalizeEvent, SimplePool } from "nostr-tools";

import { createAnchorReader, type AnchorEpoch } from "@kargain/vincent/anchor";
import {
  addressFromPrivateKey,
  signPersonalMessage,
} from "@kargain/vincent/protocol";

import {
  deriveNostrSkFromSignature,
  nostrLinkMessage,
} from "../lib/nostr/key-manager-crypto.js";
import { NOSTR_RELAYS } from "../lib/nostr/relays.js";
import { VINCENT_DATASET } from "../lib/passport/vincent-dataset.js";
import {
  buildCommonsConfirmationEvent,
  signCommonsConfirmation,
  buildUnsignedCommonsConfirmation,
} from "../lib/vincent-commons/confirmation.js";
import { verifyEpochRebuild } from "../lib/vincent-commons/confirm-epoch.js";
import { VINCENT_REGISTRY } from "../lib/vincent-commons/registry-config.js";
import { getViemChain } from "../lib/web3/supported-chains.js";
import { SEPOLIA_PUBLIC_RPC } from "../lib/web3/sepolia-addresses.js";

loadEnv({ path: ".env.local" });

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const GZIP_MAGIC = [0x1f, 0x8b] as const;
const PUBLISH_ACK_TIMEOUT_MS = 8000;

function resolveUri(uri: string, gateway: string): string {
  if (uri.startsWith("ar://")) {
    return `${gateway.replace(/\/$/, "")}/${uri.slice("ar://".length)}`;
  }
  return uri;
}

function maybeGunzip(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1]) {
    return new Uint8Array(gunzipSync(bytes));
  }
  return bytes;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return new TextDecoder().decode(maybeGunzip(bytes));
}

/** Try dataset URIs in manifest order until one fetch succeeds. */
async function fetchDatasetJsonl(uris: string[], gateway: string): Promise<string> {
  const errors: string[] = [];
  for (const uri of uris) {
    try {
      return await fetchText(resolveUri(uri, gateway));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(
    `all dataset URIs failed:\n${errors.map((e) => `  ${e}`).join("\n")}`,
  );
}

function parseIndex(raw: string | undefined): number {
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`--index must be a non-negative integer: ${raw ?? "(missing)"}`);
  }
  return index;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      publisher: { type: "string" },
      index: { type: "string" },
      "rpc-url": { type: "string", default: SEPOLIA_PUBLIC_RPC },
      relays: { type: "string" },
      gateway: { type: "string", default: VINCENT_DATASET.gatewayUrl },
      "dry-run": { type: "boolean", default: false },
    },
  });

  const publisher = values.publisher;
  if (!publisher || !ADDRESS_RE.test(publisher)) {
    throw new Error("--publisher must be a 0x-prefixed 20-byte address");
  }
  const index = parseIndex(values.index);
  const gateway = values.gateway ?? VINCENT_DATASET.gatewayUrl;
  const dryRun = values["dry-run"] === true;
  const relays = values.relays
    ? values.relays.split(",").map((r) => r.trim()).filter(Boolean)
    : [...NOSTR_RELAYS];

  const chain = getViemChain(VINCENT_REGISTRY.chainId);
  if (!chain) {
    throw new Error(`Unsupported chain: ${VINCENT_REGISTRY.chainId}`);
  }

  console.log(
    `Reading epoch ${index} for publisher ${publisher} from ${VINCENT_REGISTRY.registryAddress} (chain ${VINCENT_REGISTRY.chainId}) …`,
  );
  const reader = createAnchorReader({
    registryAddress: VINCENT_REGISTRY.registryAddress,
    chain,
    rpcUrl: values["rpc-url"] ?? SEPOLIA_PUBLIC_RPC,
  });
  const anchor: AnchorEpoch = await reader.getEpoch(
    publisher as `0x${string}`,
    index,
  );
  console.log(`  manifestHash ${anchor.manifestHash}`);
  console.log(`  jsonlSha256  ${anchor.jsonlSha256}`);
  console.log(`  merkleRoot   ${anchor.merkleRoot}`);
  console.log(`  manifestUri  ${anchor.manifestUri}`);

  console.log(`Fetching manifest …`);
  const manifestText = await fetchText(resolveUri(anchor.manifestUri, gateway));
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestText);
  } catch {
    throw new Error("manifest is not valid JSON");
  }

  // Dataset URIs come from the manifest — parse leniently here only to reach
  // them; verifyEpochRebuild re-parses fail-closed.
  const datasetUris =
    manifestJson != null &&
    typeof manifestJson === "object" &&
    "dataset" in manifestJson &&
    manifestJson.dataset != null &&
    typeof manifestJson.dataset === "object" &&
    "uris" in manifestJson.dataset &&
    Array.isArray(manifestJson.dataset.uris)
      ? manifestJson.dataset.uris.filter((u): u is string => typeof u === "string")
      : [];
  if (datasetUris.length === 0) {
    throw new Error("manifest carries no dataset URIs");
  }

  console.log(`Fetching dataset JSONL (${datasetUris.length} URI(s)) …`);
  const jsonlText = await fetchDatasetJsonl(datasetUris, gateway);

  console.log(`Rebuilding epoch via @kargain/vincent-compiler …`);
  const rebuilt = verifyEpochRebuild({
    anchor: {
      manifestHash: anchor.manifestHash,
      jsonlSha256: anchor.jsonlSha256,
      merkleRoot: anchor.merkleRoot,
    },
    manifestJson,
    jsonlText,
  });

  if (!rebuilt.ok) {
    console.error("FAIL — rebuild verification failed; nothing was signed.");
    for (const failure of rebuilt.failures) {
      console.error(`  ${failure.check}:`);
      if (failure.expected !== undefined) {
        console.error(`    expected ${failure.expected}`);
      }
      if (failure.got !== undefined) console.error(`    got      ${failure.got}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `PASS — epoch ${anchor.epoch} rebuilt byte-identically (${rebuilt.claims.length} claims).`,
  );

  if (dryRun) {
    // Address derivation only — the confirmation is never signed on dry runs.
    const envKey = process.env.VINCENT_CONFIRMER_PRIVATE_KEY;
    const attester = envKey
      ? addressFromPrivateKey(envKey)
      : "0x0000000000000000000000000000000000000000";
    console.log("Dry run — unsigned confirmation document (not signed, not published):");
    console.log(
      JSON.stringify(
        buildUnsignedCommonsConfirmation(anchor.manifestHash, attester),
        null,
        2,
      ),
    );
    if (!envKey) {
      console.log(
        "(attester placeholder — set VINCENT_CONFIRMER_PRIVATE_KEY and rerun without --dry-run to sign and publish)",
      );
    }
    return;
  }

  const privateKey = process.env.VINCENT_CONFIRMER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error(
      "VINCENT_CONFIRMER_PRIVATE_KEY not set in .env.local (or use --dry-run)",
    );
  }

  const confirmation = signCommonsConfirmation(anchor.manifestHash, privateKey);
  console.log(`Signed rebuilt confirmation as ${confirmation.attester}.`);

  // Derive the app Nostr identity from the wallet key — same canonical
  // signature path as the browser key manager, so the 31862 event author
  // matches the confirmer's attested kind 0 pubkey (gate 1).
  const walletAddress = addressFromPrivateKey(privateKey) as `0x${string}`;
  const linkSignature = signPersonalMessage(
    nostrLinkMessage(walletAddress),
    privateKey,
  ) as `0x${string}`;
  const nostrSk = deriveNostrSkFromSignature(linkSignature);

  const template = buildCommonsConfirmationEvent(
    confirmation,
    Math.floor(Date.now() / 1000),
  );
  const signed = finalizeEvent(template, hexToBytes(nostrSk));

  console.log(`Publishing kind 31862 event ${signed.id} to ${relays.length} relay(s) …`);
  const pool = new SimplePool();
  try {
    const perRelay = pool.publish(relays, signed);
    const settled = await Promise.all(
      perRelay.map((promise, i) =>
        Promise.race([
          promise.then(
            () => ({ relay: relays[i], ok: true as const }),
            (reason: unknown) => ({
              relay: relays[i],
              ok: false as const,
              reason: reason instanceof Error ? reason.message : String(reason),
            }),
          ),
          new Promise<{ relay: string; ok: false; reason: string }>((resolve) => {
            setTimeout(
              () => resolve({ relay: relays[i], ok: false, reason: "timeout" }),
              PUBLISH_ACK_TIMEOUT_MS,
            );
          }),
        ]),
      ),
    );
    let anyOk = false;
    for (const result of settled) {
      if (result.ok) {
        anyOk = true;
        console.log(`  ok      ${result.relay}`);
      } else {
        console.log(`  failed  ${result.relay} (${result.reason})`);
      }
    }
    if (!anyOk) {
      throw new Error("no relay accepted the confirmation event");
    }
    console.log(`Published confirmation for ${anchor.manifestHash}.`);
  } finally {
    pool.close(relays);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
