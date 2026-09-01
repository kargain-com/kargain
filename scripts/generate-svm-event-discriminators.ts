/**
 * Build discriminator lookup table from events.manifest.json + D-38/D-39 terminal events.
 * Wire: Anchor-style sha256("event:<Name>")[0..8] — matches kargain-events/src/lib.rs.
 *
 * Same Solidity event name on different contracts shares a discriminator; ingest resolves
 * contract from the emitting program id, not from the discriminator alone.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

type ManifestEntry = {
  contract: string;
  event: string;
};

type NamedDivergence = {
  contract: string;
  event: string;
  specId: string;
  module?: string;
};

export function eventDiscriminatorHex(eventName: string): string {
  const hash = createHash("sha256").update(`event:${eventName}`).digest();
  return hash.subarray(0, 8).toString("hex");
}

function main(): void {
  const manifestPath = path.join(
    REPO_ROOT,
    "svm/crates/kargain-events/events.manifest.json",
  );
  const divergencesPath = path.join(
    REPO_ROOT,
    "svm/crates/kargain-events/named-divergences.json",
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    entries: ManifestEntry[];
  };
  const divergences = JSON.parse(fs.readFileSync(divergencesPath, "utf8")) as NamedDivergence[];

  const byDisc = new Map<string, Map<string, string>>();

  function add(contract: string, event: string): void {
    const disc = eventDiscriminatorHex(event);
    let contracts = byDisc.get(disc);
    if (!contracts) {
      contracts = new Map();
      byDisc.set(disc, contracts);
    }
    if (contracts.has(contract)) {
      throw new Error(`Duplicate manifest row ${contract}:${event}`);
    }
    contracts.set(contract, event);
  }

  for (const entry of manifest.entries) {
    add(entry.contract, entry.event);
  }

  for (const div of divergences) {
    if (div.specId !== "D-38" && div.specId !== "D-39") continue;
    add(div.contract, div.event);
  }

  const entries = [...byDisc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([discriminatorHex, contractMap]) => ({
      discriminatorHex,
      contracts: [...contractMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([contract, event]) => ({ contract, event })),
    }));

  const outPath = path.join(REPO_ROOT, "lib/svm/discriminators.json");
  fs.writeFileSync(
    outPath,
    `${JSON.stringify({ entries, generatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  console.log(`Wrote ${entries.length} discriminators to ${path.relative(REPO_ROOT, outPath)}`);
}

main();
