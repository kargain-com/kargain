/**
 * Fetch LayerZero metadata, narrow to the testnet star (hub + spokes),
 * and write scripts/lib/layerzero-metadata.snapshot.json.
 *
 * EVM 40245/40161 chain objects are preserved from the committed file so the
 * 40245↔40161 applied-config hash does not move. EID 40168 is discovered by
 * eid (not a hardcoded chainKey) and stored as an SVM row (base58 ids).
 *
 * Usage: pnpm lz:snapshot
 */
import {
  fetchLayerZeroMetadata,
  buildSnapshotFromMetadata,
  writeSnapshot,
  SNAPSHOT_PATH,
  EID_HUB,
  EID_SPOKE,
  EID_SOLANA_DEVNET,
  isEvmLayerZeroChain,
  dvnIdsOnChain,
  dvnIdsOnBothEnds,
  HUB_SOLANA_DEVNET_REQUIRED_DVN_IDS,
  pathwayPairKey,
  readCommittedSnapshotFile,
  type LayerZeroChainSnapshot,
} from "./lib/layerzero-metadata.js";

function printChain(eid: number, chain: LayerZeroChainSnapshot): string[] {
  const vm = isEvmLayerZeroChain(chain) ? "evm" : "svm";
  return [
    `${eid} (${chain.chainKey}, ${vm}):`,
    `  endpointV2:    ${chain.endpointV2}`,
    `  sendUln302:    ${chain.sendUln302}`,
    `  receiveUln302: ${chain.receiveUln302}`,
    `  executor:      ${chain.executor}`,
    `  layerzero-labs: ${chain.dvns["layerzero-labs"] ?? "(none)"}`,
    `  nethermind:     ${chain.dvns.nethermind ?? "(none)"}`,
    `  p2p:            ${chain.dvns.p2p ?? "(none)"}`,
    `  horizen:        ${chain.dvns.horizen ?? "(none)"}`,
    `  deadDvn:        ${chain.deadDvn ?? "(none)"}`,
  ];
}

async function main(): Promise<void> {
  const previous = readCommittedSnapshotFile();
  const full = await fetchLayerZeroMetadata();
  const snapshot = buildSnapshotFromMetadata(
    full,
    new Date().toISOString(),
    previous ?? undefined,
  );
  writeSnapshot(snapshot);

  const hub = snapshot.chains[EID_HUB];
  const solana = snapshot.chains[EID_SOLANA_DEVNET];
  const intersection =
    hub && solana ? dvnIdsOnBothEnds(hub, solana) : [];
  const livePathway =
    snapshot.pathways[pathwayPairKey(EID_HUB, EID_SPOKE)];
  const solanaPathway =
    snapshot.pathways[pathwayPairKey(EID_HUB, EID_SOLANA_DEVNET)];

  const lines = [
    `Wrote ${SNAPSHOT_PATH}`,
    `sha256: ${snapshot.sha256}`,
    `fetchedAt: ${snapshot.fetchedAt}`,
    livePathway
      ? `confirmations (40245↔40161): ${livePathway.confirmations["40245→40161"]} / ${livePathway.confirmations["40161→40245"]} (${livePathway.source})`
      : `confirmations (40245↔40161): (missing pathway)`,
    "",
    ...printChain(EID_HUB, snapshot.chains[EID_HUB]!),
    "",
    ...printChain(EID_SPOKE, snapshot.chains[EID_SPOKE]!),
    "",
  ];

  if (solana) {
    lines.push(...printChain(EID_SOLANA_DEVNET, solana), "");
    lines.push(
      `П-5 40245 ∩ 40168 DVN ids: [${intersection.join(", ")}]`,
      `П-5 pinned pair: [${HUB_SOLANA_DEVNET_REQUIRED_DVN_IDS.join(", ")}]`,
      `П-5 40168 dvns on chain: [${dvnIdsOnChain(solana).join(", ")}]`,
    );
    if (solanaPathway) {
      const hubTo = solanaPathway.confirmations["40245→40168"];
      const toHub = solanaPathway.confirmations["40168→40245"];
      lines.push(
        `П-5 confirmations 40245↔40168: ${hubTo} / ${toHub} (${solanaPathway.source})`,
        `П-5 requiredDvnIds: [${solanaPathway.requiredDvnIds.join(", ")}]`,
      );
    }
    lines.push("");
  } else {
    lines.push("40168: (missing — blocking)", "");
  }

  process.stdout.write(lines.join("\n"));
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
