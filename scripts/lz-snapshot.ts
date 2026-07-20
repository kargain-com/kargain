/**
 * Fetch LayerZero metadata, narrow to Base Sepolia / Ethereum Sepolia testnets,
 * and write scripts/lib/layerzero-metadata.snapshot.json.
 *
 * Usage: pnpm lz:snapshot
 */
import {
  fetchLayerZeroMetadata,
  buildSnapshotFromMetadata,
  writeSnapshot,
  SNAPSHOT_PATH,
} from "./lib/layerzero-metadata.js";

async function main(): Promise<void> {
  const full = await fetchLayerZeroMetadata();
  const snapshot = buildSnapshotFromMetadata(full);
  writeSnapshot(snapshot);
  process.stdout.write(
    [
      `Wrote ${SNAPSHOT_PATH}`,
      `sha256: ${snapshot.sha256}`,
      `fetchedAt: ${snapshot.fetchedAt}`,
      `confirmations: ${snapshot.confirmations["40245→40161"]} / ${snapshot.confirmations["40161→40245"]} (${snapshot.confirmations.source})`,
      "",
      `40245 (${snapshot.chains[40245].chainKey}):`,
      `  endpointV2:    ${snapshot.chains[40245].endpointV2}`,
      `  sendUln302:    ${snapshot.chains[40245].sendUln302}`,
      `  receiveUln302: ${snapshot.chains[40245].receiveUln302}`,
      `  executor:      ${snapshot.chains[40245].executor}`,
      `  layerzero-labs: ${snapshot.chains[40245].dvns["layerzero-labs"]}`,
      `  nethermind:     ${snapshot.chains[40245].dvns.nethermind}`,
      `  p2p:            ${snapshot.chains[40245].dvns.p2p}`,
      `  horizen:        ${snapshot.chains[40245].dvns.horizen}`,
      `  deadDvn:        ${snapshot.chains[40245].deadDvn ?? "(none)"}`,
      "",
      `40161 (${snapshot.chains[40161].chainKey}):`,
      `  endpointV2:    ${snapshot.chains[40161].endpointV2}`,
      `  sendUln302:    ${snapshot.chains[40161].sendUln302}`,
      `  receiveUln302: ${snapshot.chains[40161].receiveUln302}`,
      `  executor:      ${snapshot.chains[40161].executor}`,
      `  layerzero-labs: ${snapshot.chains[40161].dvns["layerzero-labs"]}`,
      `  nethermind:     ${snapshot.chains[40161].dvns.nethermind}`,
      `  p2p:            ${snapshot.chains[40161].dvns.p2p}`,
      `  horizen:        ${snapshot.chains[40161].dvns.horizen}`,
      `  deadDvn:        ${snapshot.chains[40161].deadDvn ?? "(none)"}`,
      "",
    ].join("\n"),
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
