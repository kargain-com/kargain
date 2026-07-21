/**
 * Pure LayerZero pathway builders and §7.6 validators.
 * No I/O — addresses/EIDs come from the metadata snapshot + manifests.
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
  EID_HUB,
  EID_SPOKE,
  REQUIRED_DVN_IDS,
  type LayerZeroChainSnapshot,
  type LayerZeroMetadataSnapshot,
} from "./layerzero-metadata.js";

export const ALLOWED_EIDS = new Set<number>([EID_HUB, EID_SPOKE]);

/** Star topology: hub ↔ spoke only. */
export const STAR_REMOTE_EID: Record<typeof EID_HUB | typeof EID_SPOKE, typeof EID_HUB | typeof EID_SPOKE> = {
  [EID_HUB]: EID_SPOKE,
  [EID_SPOKE]: EID_HUB,
};

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
  hubEid: typeof EID_HUB;
  spokeEid: typeof EID_SPOKE;
  hubOApp: Address;
  spokeOApp: Address;
};

export function assertAllowedEid(eid: number): asserts eid is typeof EID_HUB | typeof EID_SPOKE {
  if (!ALLOWED_EIDS.has(eid)) {
    throw new Error(`EID ${eid} is not in the testnet allowlist {${EID_HUB}, ${EID_SPOKE}}`);
  }
}

export function assertTestnetPathway(srcEid: number, dstEid: number): void {
  assertAllowedEid(srcEid);
  assertAllowedEid(dstEid);
  if (srcEid === dstEid) {
    throw new Error(`Pathway cannot be self-referential (eid ${srcEid})`);
  }
  if (STAR_REMOTE_EID[srcEid] !== dstEid) {
    throw new Error(
      `Star topology violation: only hub ${EID_HUB} ↔ spoke ${EID_SPOKE} is allowed (got ${srcEid}→${dstEid})`,
    );
  }
}

export function remoteEidFor(localEid: typeof EID_HUB | typeof EID_SPOKE): typeof EID_HUB | typeof EID_SPOKE {
  return STAR_REMOTE_EID[localEid];
}

/** Sort + dedupe addresses ascending (checksum-cased for determinism via getAddress). */
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
}): UlnConfig {
  if (!Number.isInteger(params.confirmations) || params.confirmations < 1) {
    throw new Error(`confirmations must be a positive integer (got ${params.confirmations})`);
  }
  const requiredDVNs = sortAndDedupeAddresses(params.requiredDVNs);
  const optionalDVNs = sortAndDedupeAddresses(params.optionalDVNs ?? []);
  if (requiredDVNs.length !== 2) {
    throw new Error(
      `requiredDVNCount must be 2 after sort/dedupe (got ${requiredDVNs.length})`,
    );
  }
  if (optionalDVNs.length !== 0) {
    throw new Error(`optional DVN list must be empty (got ${optionalDVNs.length})`);
  }
  return {
    confirmations: BigInt(params.confirmations),
    requiredDVNCount: 2,
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

export function assertLibrariesPinned(
  chain: LayerZeroChainSnapshot,
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

export function assertRequiredDvnCount(requiredDVNCount: number): string[] {
  if (requiredDVNCount < 2) {
    return [`requiredDVNCount ${requiredDVNCount} < 2 (§7.6)`];
  }
  return [];
}

export function assertReciprocalPeers(peers: PathwayPeers): string[] {
  const errors: string[] = [];
  if (peers.hubEid !== EID_HUB || peers.spokeEid !== EID_SPOKE) {
    errors.push(
      `peer EIDs must be hub ${EID_HUB} / spoke ${EID_SPOKE} (got ${peers.hubEid}/${peers.spokeEid})`,
    );
  }
  if (getAddress(peers.hubOApp) === zeroAddress) {
    errors.push("hubOApp must not be address(0)");
  }
  if (getAddress(peers.spokeOApp) === zeroAddress) {
    errors.push("spokeOApp must not be address(0)");
  }
  if (getAddress(peers.hubOApp) === getAddress(peers.spokeOApp)) {
    errors.push("hubOApp and spokeOApp must differ");
  }
  return errors;
}

/** Required DVN addresses for a local chain from the snapshot. */
export function requiredDvnsFromSnapshot(chain: LayerZeroChainSnapshot): Address[] {
  return REQUIRED_DVN_IDS.map((id) => getAddress(chain.dvns[id]));
}

export function ulnConfirmationsForDirection(
  snapshot: LayerZeroMetadataSnapshot,
  srcEid: typeof EID_HUB | typeof EID_SPOKE,
  dstEid: typeof EID_HUB | typeof EID_SPOKE,
): number {
  assertTestnetPathway(srcEid, dstEid);
  if (srcEid === EID_HUB && dstEid === EID_SPOKE) {
    return snapshot.confirmations["40245→40161"];
  }
  return snapshot.confirmations["40161→40245"];
}

/**
 * Canonical applied-config object hashed into pathwayConfigHash on successful wire.
 */
export type AppliedPathwayConfig = {
  hubEid: typeof EID_HUB;
  spokeEid: typeof EID_SPOKE;
  hubOApp: Address;
  spokeOApp: Address;
  confirmations: { "40245→40161": number; "40161→40245": number };
  requiredDvns: {
    [EID_HUB]: Address[];
    [EID_SPOKE]: Address[];
  };
  libraries: {
    [EID_HUB]: { sendUln302: Address; receiveUln302: Address; executor: Address };
    [EID_SPOKE]: { sendUln302: Address; receiveUln302: Address; executor: Address };
  };
  enforcedGas: {
    send: typeof ENFORCED_GAS_SEND;
    sendAndCompose: typeof ENFORCED_GAS_SEND_AND_COMPOSE;
  };
  metadataSha256: string;
};

export function buildAppliedPathwayConfig(
  snapshot: LayerZeroMetadataSnapshot,
  peers: PathwayPeers,
): AppliedPathwayConfig {
  const hub = snapshot.chains[EID_HUB];
  const spoke = snapshot.chains[EID_SPOKE];
  return {
    hubEid: EID_HUB,
    spokeEid: EID_SPOKE,
    hubOApp: getAddress(peers.hubOApp),
    spokeOApp: getAddress(peers.spokeOApp),
    confirmations: {
      "40245→40161": snapshot.confirmations["40245→40161"],
      "40161→40245": snapshot.confirmations["40161→40245"],
    },
    requiredDvns: {
      [EID_HUB]: requiredDvnsFromSnapshot(hub),
      [EID_SPOKE]: requiredDvnsFromSnapshot(spoke),
    },
    libraries: {
      [EID_HUB]: {
        sendUln302: getAddress(hub.sendUln302),
        receiveUln302: getAddress(hub.receiveUln302),
        executor: getAddress(hub.executor),
      },
      [EID_SPOKE]: {
        sendUln302: getAddress(spoke.sendUln302),
        receiveUln302: getAddress(spoke.receiveUln302),
        executor: getAddress(spoke.executor),
      },
    },
    enforcedGas: {
      send: ENFORCED_GAS_SEND,
      sendAndCompose: ENFORCED_GAS_SEND_AND_COMPOSE,
    },
    metadataSha256: snapshot.sha256,
  };
}
