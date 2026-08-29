/**
 * Pure LayerZero pathway builders and §7.6 validators.
 * No I/O — addresses/EIDs come from the metadata snapshot + manifests.
 *
 * Topology: one hub, N spokes. A pathway is valid iff exactly one end is the hub.
 * Required DVNs and confirmations are per-pathway. ULN/executor encoders are EVM-only.
 */
import { Options } from "@layerzerolabs/lz-v2-utilities";
import {
  encodeAbiParameters,
  getAddress,
  padHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import {
  ENFORCED_GAS_SEND,
  ENFORCED_GAS_SEND_AND_COMPOSE,
} from "../../lib/web3/bridge/lz-receive-gas.js";
import {
  normalizeProtocolAddressForVm,
  svmPubkeyToBytes32,
} from "../../lib/web3/protocol-address.js";
import {
  confirmationDirectionKey,
  EID_HUB,
  EID_SOLANA_DEVNET,
  EID_SPOKE,
  isEvmLayerZeroChain,
  isSvmLayerZeroChain,
  KNOWN_TESTNET_SPOKE_EIDS,
  pathwayPairKey,
  pathwayRecord,
  sha256Canonical,
  spokeEidsFromSnapshot,
  type LayerZeroEvmChainSnapshot,
  type LayerZeroMetadataSnapshot,
  type LayerZeroSvmChainSnapshot,
} from "./layerzero-metadata.js";

export const CONFIG_TYPE_EXECUTOR = 1;
export const CONFIG_TYPE_ULN = 2;

/** ONFT SEND (return path / non-compose). */
export const MSG_TYPE_SEND = 1;
/** ONFT SEND_AND_COMPOSE (hub→spoke with URI). */
export const MSG_TYPE_SEND_AND_COMPOSE = 2;

/**
 * Pathway enforcedOptions floors (owned by `lib/web3/bridge/lz-receive-gas.ts`).
 * Typical Irys/`ar://` URIs fit under type2 250k; hub UI may raise lzReceive via
 * sender `extraOptions` from URI-length policy — do not bump these floors lightly
 * (changes `pathwayConfigHash` / requires re-wire).
 */
export { ENFORCED_GAS_SEND, ENFORCED_GAS_SEND_AND_COMPOSE };

/** Pinned max message size for ExecutorConfig (fits compose + long URI). */
export const EXECUTOR_MAX_MESSAGE_SIZE = 10_000;

export type UlnConfig = {
  confirmations: bigint;
  requiredDVNCount: number;
  optionalDVNCount: number;
  optionalDVNThreshold: number;
  requiredDVNs: Address[];
  optionalDVNs: Address[];
};

export type ExecutorConfig = {
  maxMessageSize: number;
  executor: Address;
};

export type EnforcedOptionParam = {
  eid: number;
  msgType: number;
  options: Hex;
};

export type PathwayPeers = {
  hubEid: number;
  spokeEid: number;
  hubOApp: Address;
  /** EVM checksum address or SVM base58 program id. */
  spokeOApp: string;
};

export type UlnEnvironment = "testnet" | "mainnet";

export function isKnownTestnetStarEid(eid: number): boolean {
  return eid === EID_HUB || KNOWN_TESTNET_SPOKE_EIDS.includes(eid);
}

export function assertAllowedEid(eid: number): void {
  if (!isKnownTestnetStarEid(eid)) {
    throw new Error(
      `EID ${eid} is not in the testnet star {hub ${EID_HUB}, spokes ${KNOWN_TESTNET_SPOKE_EIDS.join(",")}}`,
    );
  }
}

/**
 * A pathway is valid iff exactly one end is the hub. Spoke↔spoke is refused by name.
 */
export function assertStarPathway(srcEid: number, dstEid: number): void {
  if (srcEid === dstEid) {
    throw new Error(`Pathway cannot be self-referential (eid ${srcEid})`);
  }
  const srcIsHub = srcEid === EID_HUB;
  const dstIsHub = dstEid === EID_HUB;
  if (!srcIsHub && !dstIsHub) {
    throw new Error(`Spoke↔spoke pathway refused: ${srcEid}→${dstEid}`);
  }
  const spoke = srcIsHub ? dstEid : srcEid;
  if (!KNOWN_TESTNET_SPOKE_EIDS.includes(spoke)) {
    throw new Error(
      `Star topology violation: ${spoke} is not a spoke of hub ${EID_HUB} (got ${srcEid}→${dstEid})`,
    );
  }
}

/** Previous name — star pathway (hub↔spoke only). */
export const assertTestnetPathway = assertStarPathway;

export function remoteEidsFor(
  localEid: number,
  spokeEids: readonly number[] = KNOWN_TESTNET_SPOKE_EIDS,
): number[] {
  if (localEid === EID_HUB) return [...spokeEids];
  if (spokeEids.includes(localEid)) return [EID_HUB];
  throw new Error(`EID ${localEid} is not the hub or a known spoke`);
}

/** Sort + dedupe addresses ascending (checksum-cased for determinism via getAddress). EVM-only. */
export function sortAndDedupeAddresses(addresses: readonly Address[]): Address[] {
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const a of addresses) {
    const c = getAddress(a);
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  out.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return out;
}

export function buildUlnConfig(params: {
  confirmations: number;
  requiredDVNs: readonly Address[];
  optionalDVNs?: readonly Address[];
  environment?: UlnEnvironment;
}): UlnConfig {
  if (!Number.isInteger(params.confirmations) || params.confirmations < 1) {
    throw new Error(`confirmations must be a positive integer (got ${params.confirmations})`);
  }
  const requiredDVNs = sortAndDedupeAddresses(params.requiredDVNs);
  const optionalDVNs = sortAndDedupeAddresses(params.optionalDVNs ?? []);
  const env = params.environment ?? "testnet";
  const n = requiredDVNs.length;
  if (env === "testnet") {
    if (n < 2) {
      throw new Error(
        `requiredDVNCount must be at least 2 on testnet after sort/dedupe (got ${n})`,
      );
    }
  } else if (n < 3 || n > 5) {
    throw new Error(
      `requiredDVNCount must be 3–5 on mainnet after sort/dedupe (got ${n})`,
    );
  }
  if (optionalDVNs.length !== 0) {
    throw new Error(`optional DVN list must be empty (got ${optionalDVNs.length})`);
  }
  return {
    confirmations: BigInt(params.confirmations),
    requiredDVNCount: n,
    optionalDVNCount: 0,
    optionalDVNThreshold: 0,
    requiredDVNs,
    optionalDVNs: [],
  };
}

export function buildExecutorConfig(executor: Address): ExecutorConfig {
  const ex = getAddress(executor);
  if (ex === zeroAddress) {
    throw new Error("executor must not be address(0)");
  }
  return {
    maxMessageSize: EXECUTOR_MAX_MESSAGE_SIZE,
    executor: ex,
  };
}

export function encodeUlnConfig(config: UlnConfig): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "confirmations", type: "uint64" },
          { name: "requiredDVNCount", type: "uint8" },
          { name: "optionalDVNCount", type: "uint8" },
          { name: "optionalDVNThreshold", type: "uint8" },
          { name: "requiredDVNs", type: "address[]" },
          { name: "optionalDVNs", type: "address[]" },
        ],
      },
    ],
    [
      {
        confirmations: config.confirmations,
        requiredDVNCount: config.requiredDVNCount,
        optionalDVNCount: config.optionalDVNCount,
        optionalDVNThreshold: config.optionalDVNThreshold,
        requiredDVNs: config.requiredDVNs,
        optionalDVNs: config.optionalDVNs,
      },
    ],
  );
}

export function encodeExecutorConfig(config: ExecutorConfig): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "maxMessageSize", type: "uint32" },
          { name: "executor", type: "address" },
        ],
      },
    ],
    [{ maxMessageSize: config.maxMessageSize, executor: config.executor }],
  );
}

export type SetConfigParam = {
  eid: number;
  configType: number;
  config: Hex;
};

export function buildSendLibSetConfigParams(
  remoteEid: number,
  uln: UlnConfig,
  executor: ExecutorConfig,
): SetConfigParam[] {
  assertAllowedEid(remoteEid);
  return [
    {
      eid: remoteEid,
      configType: CONFIG_TYPE_EXECUTOR,
      config: encodeExecutorConfig(executor),
    },
    {
      eid: remoteEid,
      configType: CONFIG_TYPE_ULN,
      config: encodeUlnConfig(uln),
    },
  ];
}

export function buildReceiveLibSetConfigParams(
  remoteEid: number,
  uln: UlnConfig,
): SetConfigParam[] {
  assertAllowedEid(remoteEid);
  return [
    {
      eid: remoteEid,
      configType: CONFIG_TYPE_ULN,
      config: encodeUlnConfig(uln),
    },
  ];
}

function lzReceiveOptions(gas: number): Hex {
  return Options.newOptions().addExecutorLzReceiveOption(gas, 0).toHex() as Hex;
}

export function buildEnforcedOptions(remoteEid: number): EnforcedOptionParam[] {
  assertAllowedEid(remoteEid);
  return [
    {
      eid: remoteEid,
      msgType: MSG_TYPE_SEND,
      options: lzReceiveOptions(ENFORCED_GAS_SEND),
    },
    {
      eid: remoteEid,
      msgType: MSG_TYPE_SEND_AND_COMPOSE,
      options: lzReceiveOptions(ENFORCED_GAS_SEND_AND_COMPOSE),
    },
  ];
}

export function addressToBytes32(addr: Address): Hex {
  return padHex(getAddress(addr), { size: 32 });
}

/** SVM program / pubkey → LayerZero bytes32 peer (owner: protocol-address). */
export { svmPubkeyToBytes32 };

/**
 * Peer bytes32 for an OApp identity on `remoteEid`'s VM class.
 * EVM remotes: left-padded address. SVM remotes: raw 32-byte pubkey.
 */
export function peerToBytes32(remoteEid: number, remoteOApp: string): Hex {
  assertAllowedEid(remoteEid);
  if (remoteEid === EID_SOLANA_DEVNET) {
    return svmPubkeyToBytes32(remoteOApp);
  }
  return addressToBytes32(getAddress(remoteOApp));
}

export function requireEvmChain(
  snapshot: LayerZeroMetadataSnapshot,
  eid: number,
): LayerZeroEvmChainSnapshot {
  const chain = snapshot.chains[eid];
  if (!chain) {
    throw new Error(`Snapshot has no chain for eid ${eid}`);
  }
  if (!isEvmLayerZeroChain(chain)) {
    throw new Error(`EID ${eid} is not an EVM snapshot chain`);
  }
  return chain;
}

export function requireSvmChain(
  snapshot: LayerZeroMetadataSnapshot,
  eid: number,
): LayerZeroSvmChainSnapshot {
  const chain = snapshot.chains[eid];
  if (!chain) {
    throw new Error(`Snapshot has no chain for eid ${eid}`);
  }
  if (!isSvmLayerZeroChain(chain)) {
    throw new Error(`EID ${eid} is not an SVM snapshot chain`);
  }
  return chain;
}

export function assertLibrariesPinned(
  chain: LayerZeroEvmChainSnapshot,
  observed: {
    sendLibrary: Address;
    receiveLibrary: Address;
    isDefaultSend: boolean;
    isDefaultReceive: boolean;
  },
): string[] {
  const errors: string[] = [];
  const send = getAddress(observed.sendLibrary);
  const recv = getAddress(observed.receiveLibrary);
  if (send === zeroAddress) {
    errors.push(`send library is address(0) on eid ${chain.eid}`);
  }
  if (recv === zeroAddress) {
    errors.push(`receive library is address(0) on eid ${chain.eid}`);
  }
  if (observed.isDefaultSend) {
    errors.push(`default send library detected on eid ${chain.eid} (§7.6 no defaults)`);
  }
  if (observed.isDefaultReceive) {
    errors.push(`default receive library detected on eid ${chain.eid} (§7.6 no defaults)`);
  }
  if (send !== getAddress(chain.sendUln302)) {
    errors.push(
      `send library ${send} !== snapshot sendUln302 ${chain.sendUln302} (eid ${chain.eid})`,
    );
  }
  if (recv !== getAddress(chain.receiveUln302)) {
    errors.push(
      `receive library ${recv} !== snapshot receiveUln302 ${chain.receiveUln302} (eid ${chain.eid})`,
    );
  }
  return errors;
}

export function assertNoDeadDvnInRequired(
  requiredDVNs: readonly Address[],
  deadDvn: Address | null,
): string[] {
  if (!deadDvn) return [];
  const dead = getAddress(deadDvn).toLowerCase();
  const hit = requiredDVNs.some((a) => getAddress(a).toLowerCase() === dead);
  if (hit) {
    return [`dead DVN ${deadDvn} must not appear in required DVN set`];
  }
  return [];
}

export function assertRequiredDvnCount(
  requiredDVNCount: number,
  environment: UlnEnvironment = "testnet",
): string[] {
  if (environment === "testnet") {
    if (requiredDVNCount < 2) {
      return [`requiredDVNCount ${requiredDVNCount} < 2 (§7.6)`];
    }
    return [];
  }
  if (requiredDVNCount < 3 || requiredDVNCount > 5) {
    return [`requiredDVNCount ${requiredDVNCount} not in 3–5 for mainnet (§7.6)`];
  }
  return [];
}

export function assertReciprocalPeers(peers: PathwayPeers): string[] {
  const errors: string[] = [];
  if (peers.hubEid !== EID_HUB) {
    errors.push(`peer hubEid must be ${EID_HUB} (got ${peers.hubEid})`);
  }
  if (peers.spokeEid === EID_HUB || !KNOWN_TESTNET_SPOKE_EIDS.includes(peers.spokeEid)) {
    errors.push(
      `peer spokeEid must be a spoke of hub ${EID_HUB} (got ${peers.spokeEid})`,
    );
  }
  if (getAddress(peers.hubOApp) === zeroAddress) {
    errors.push("hubOApp must not be address(0)");
  }
  if (peers.spokeEid === EID_SOLANA_DEVNET) {
    const spoke = normalizeProtocolAddressForVm("svm", peers.spokeOApp);
    if (spoke == null) {
      errors.push("spokeOApp must be a valid Solana base58 pubkey");
    }
  } else {
    if (getAddress(peers.spokeOApp as Address) === zeroAddress) {
      errors.push("spokeOApp must not be address(0)");
    }
    if (getAddress(peers.hubOApp) === getAddress(peers.spokeOApp as Address)) {
      errors.push("hubOApp and spokeOApp must differ");
    }
  }
  return errors;
}

/** Required EVM DVN addresses on `localEid` for the pathway to `remoteEid`. */
export function requiredDvnsForPathway(
  snapshot: LayerZeroMetadataSnapshot,
  localEid: number,
  remoteEid: number,
): Address[] {
  const record = pathwayRecord(snapshot, localEid, remoteEid);
  const chain = requireEvmChain(snapshot, localEid);
  const ids = record.requiredDvnIds;
  if (ids.length === 0) {
    throw new Error(
      `Pathway ${localEid}↔${remoteEid} has no requiredDvnIds (refuse silent live-pair copy)`,
    );
  }
  return ids.map((id) => {
    const addr = chain.dvns[id];
    if (!addr) {
      throw new Error(`DVN ${id} missing on eid ${localEid} for pathway ${localEid}↔${remoteEid}`);
    }
    return getAddress(addr);
  });
}

export function ulnConfirmationsForDirection(
  snapshot: LayerZeroMetadataSnapshot,
  srcEid: number,
  dstEid: number,
): number {
  assertStarPathway(srcEid, dstEid);
  const record = pathwayRecord(snapshot, srcEid, dstEid);
  const key = confirmationDirectionKey(srcEid, dstEid);
  const value = record.confirmations[key];
  if (value == null) {
    throw new Error(`No confirmations for ${key} on pathway ${pathwayPairKey(srcEid, dstEid)}`);
  }
  return value;
}

/**
 * Canonical applied-config object hashed into pathwayConfigHash on successful wire.
 * Confirmation keys keep `${src}→${dst}` form so 40245↔40161 stays byte-identical
 * through the topology refactor.
 */
export type AppliedPathwayConfig = {
  hubEid: number;
  spokeEid: number;
  hubOApp: Address;
  /** EVM checksum address or SVM base58 program id. */
  spokeOApp: string;
  confirmations: Record<string, number>;
  requiredDvns: Record<number, Address[] | string[]>;
  libraries: Record<
    number,
    { sendUln302: string; receiveUln302: string; executor: string }
  >;
  enforcedGas: {
    send: typeof ENFORCED_GAS_SEND;
    sendAndCompose: typeof ENFORCED_GAS_SEND_AND_COMPOSE;
  };
  metadataSha256: string;
};

export function pathwayChainsDigest(
  snapshot: LayerZeroMetadataSnapshot,
  hubEid: number,
  spokeEid: number,
): string {
  const hub = snapshot.chains[hubEid];
  const spoke = snapshot.chains[spokeEid];
  if (!hub || !spoke) {
    throw new Error(`Cannot digest pathway ${hubEid}↔${spokeEid}: missing chain snapshot`);
  }
  return sha256Canonical({ [hubEid]: hub, [spokeEid]: spoke });
}

export function buildAppliedPathwayConfig(
  snapshot: LayerZeroMetadataSnapshot,
  peers: PathwayPeers,
): AppliedPathwayConfig {
  const hubEid = peers.hubEid;
  const spokeEid = peers.spokeEid;
  assertStarPathway(hubEid, spokeEid);
  const hub = requireEvmChain(snapshot, hubEid);
  const hubToSpoke = confirmationDirectionKey(hubEid, spokeEid);
  const spokeToHub = confirmationDirectionKey(spokeEid, hubEid);

  if (spokeEid === EID_SOLANA_DEVNET) {
    const spoke = requireSvmChain(snapshot, spokeEid);
    const spokeNorm = normalizeProtocolAddressForVm("svm", peers.spokeOApp);
    if (spokeNorm == null) {
      throw new Error(`Invalid SVM spokeOApp: ${peers.spokeOApp}`);
    }
    return {
      hubEid,
      spokeEid,
      hubOApp: getAddress(peers.hubOApp),
      spokeOApp: spokeNorm,
      confirmations: {
        [hubToSpoke]: ulnConfirmationsForDirection(snapshot, hubEid, spokeEid),
        [spokeToHub]: ulnConfirmationsForDirection(snapshot, spokeEid, hubEid),
      },
      requiredDvns: {
        [hubEid]: requiredDvnsForPathway(snapshot, hubEid, spokeEid),
        // SVM DVN pubkeys from snapshot (not EVM Address[]) — wire is hub-side ULN only.
        [spokeEid]: pathwayRecord(snapshot, hubEid, spokeEid).requiredDvnIds.map((id) => {
          const addr = spoke.dvns[id];
          if (!addr) {
            throw new Error(`DVN ${id} missing on SVM eid ${spokeEid}`);
          }
          return addr;
        }),
      },
      libraries: {
        [hubEid]: {
          sendUln302: getAddress(hub.sendUln302),
          receiveUln302: getAddress(hub.receiveUln302),
          executor: getAddress(hub.executor),
        },
        [spokeEid]: {
          sendUln302: spoke.sendUln302,
          receiveUln302: spoke.receiveUln302,
          executor: spoke.executor,
        },
      },
      enforcedGas: {
        send: ENFORCED_GAS_SEND,
        sendAndCompose: ENFORCED_GAS_SEND_AND_COMPOSE,
      },
      metadataSha256: pathwayChainsDigest(snapshot, hubEid, spokeEid),
    };
  }

  const spoke = requireEvmChain(snapshot, spokeEid);
  return {
    hubEid,
    spokeEid,
    hubOApp: getAddress(peers.hubOApp),
    spokeOApp: getAddress(peers.spokeOApp as Address),
    confirmations: {
      [hubToSpoke]: ulnConfirmationsForDirection(snapshot, hubEid, spokeEid),
      [spokeToHub]: ulnConfirmationsForDirection(snapshot, spokeEid, hubEid),
    },
    requiredDvns: {
      [hubEid]: requiredDvnsForPathway(snapshot, hubEid, spokeEid),
      [spokeEid]: requiredDvnsForPathway(snapshot, spokeEid, hubEid),
    },
    libraries: {
      [hubEid]: {
        sendUln302: getAddress(hub.sendUln302),
        receiveUln302: getAddress(hub.receiveUln302),
        executor: getAddress(hub.executor),
      },
      [spokeEid]: {
        sendUln302: getAddress(spoke.sendUln302),
        receiveUln302: getAddress(spoke.receiveUln302),
        executor: getAddress(spoke.executor),
      },
    },
    enforcedGas: {
      send: ENFORCED_GAS_SEND,
      sendAndCompose: ENFORCED_GAS_SEND_AND_COMPOSE,
    },
    metadataSha256: pathwayChainsDigest(snapshot, hubEid, spokeEid),
  };
}

export function hashAppliedPathwayConfig(applied: AppliedPathwayConfig): Hex {
  return `0x${sha256Canonical(applied)}`;
}

export { EID_HUB, EID_SPOKE, EID_SOLANA_DEVNET, spokeEidsFromSnapshot };
