/**
 * Sole SQL load + fold owner for passport custody (S7c-3).
 * EVM Ponder tables + optional kargain_svm_projection custody mirror.
 */

import pg from "pg";

import {
  adaptEvmBridgeCrossingRows,
  type EvmBridgeCrossingRow,
} from "@/lib/custody/adapt-evm-bridge-crossings.js";
import {
  adaptEvmCustodyDeterminingRows,
  type EvmCustodyDeterminingRow,
} from "@/lib/custody/adapt-evm-custody-events.js";
import { foldPassportCustody } from "@/lib/custody/fold.js";
import {
  passportCustodyAnswerFromFold,
  type CustodyFoldResult,
  type PassportCustodyAnswer,
} from "@/lib/custody/normalized-event.js";
import { registeredCommercialNamespaceIds } from "@/lib/web3/commercial-active";

export type { PassportCustodyAnswer };

export type CustodyQueryOptions = {
  namespaces?: readonly number[];
  includeSvmProjection?: boolean;
};

let poolSingleton: pg.Pool | null = null;

function getCustodyPool(): pg.Pool {
  if (!poolSingleton) {
    const connectionString =
      process.env.DATABASE_URL?.trim() ??
      process.env.SVM_INGEST_DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL or SVM_INGEST_DATABASE_URL required for custody fold reads",
      );
    }
    poolSingleton = new pg.Pool({ connectionString });
  }
  return poolSingleton;
}

function resolveNamespaces(opts?: CustodyQueryOptions): number[] {
  if (opts?.namespaces != null) return [...opts.namespaces];
  return [...registeredCommercialNamespaceIds()];
}

function isRegisteredNamespace(
  namespaces: readonly number[],
): (namespace: number) => boolean {
  const set = new Set(namespaces);
  return (ns) => set.has(ns);
}

export type CustodyFoldInputs = {
  tokenId: string;
  streamB: ReturnType<typeof adaptEvmCustodyDeterminingRows>;
  crossings: ReturnType<typeof adaptEvmBridgeCrossingRows>;
  namespaces: number[];
};

export async function loadCustodyFoldInputs(
  pool: pg.Pool,
  tokenId: string,
  opts?: CustodyQueryOptions,
): Promise<CustodyFoldInputs> {
  const namespaces = resolveNamespaces(opts);
  const includeSvm = opts?.includeSvmProjection !== false;

  const evmStreamPromise = pool.query<EvmCustodyDeterminingRow>(
    `SELECT token_id AS "tokenId", chain_id AS "chainId", kind,
            block_number AS "blockNumber", log_index AS "logIndex"
     FROM kargain.custody_determining_event
     WHERE token_id = $1`,
    [tokenId],
  );

  const evmCrossingsPromise = pool.query<EvmBridgeCrossingRow>(
    `SELECT guid, direction, token_id AS "tokenId",
            observing_chain_id AS "observingChainId",
            peer_namespace AS "peerNamespace",
            peer_namespace_refusal AS "peerNamespaceRefusal",
            block_number AS "blockNumber", log_index AS "logIndex"
     FROM kargain.bridge_crossing
     WHERE token_id = $1`,
    [tokenId],
  );

  const svmStreamPromise = includeSvm
    ? pool.query<EvmCustodyDeterminingRow>(
        `SELECT token_id AS "tokenId", chain_id AS "chainId", kind,
                block_number AS "blockNumber", log_index AS "logIndex"
         FROM kargain_svm_projection.custody_determining_event
         WHERE token_id = $1 AND chain_id = ANY($2::int[])`,
        [tokenId, namespaces],
      )
    : Promise.resolve({ rows: [] as EvmCustodyDeterminingRow[] });

  const [evmStream, evmCrossings, svmStream] = await Promise.all([
    evmStreamPromise,
    evmCrossingsPromise,
    svmStreamPromise,
  ]);

  const streamRows = [...evmStream.rows, ...svmStream.rows];
  return {
    tokenId,
    streamB: adaptEvmCustodyDeterminingRows(streamRows),
    crossings: adaptEvmBridgeCrossingRows(evmCrossings.rows),
    namespaces,
  };
}

export function resolvePassportCustodyFromInputs(
  inputs: CustodyFoldInputs,
): CustodyFoldResult {
  return foldPassportCustody({
    tokenId: inputs.tokenId,
    streamB: inputs.streamB,
    crossings: inputs.crossings,
    isRegisteredNamespace: isRegisteredNamespace(inputs.namespaces),
  });
}

export async function resolvePassportCustodyAnswer(
  tokenId: string,
  opts?: CustodyQueryOptions,
  pool?: pg.Pool,
): Promise<PassportCustodyAnswer> {
  const pgPool = pool ?? getCustodyPool();
  const inputs = await loadCustodyFoldInputs(pgPool, tokenId, opts);
  return passportCustodyAnswerFromFold(resolvePassportCustodyFromInputs(inputs));
}

export async function resolvePassportCustodyAnswersBatch(
  tokenIds: readonly string[],
  opts?: CustodyQueryOptions,
  pool?: pg.Pool,
): Promise<Map<string, PassportCustodyAnswer>> {
  const out = new Map<string, PassportCustodyAnswer>();
  if (tokenIds.length === 0) return out;
  const pgPool = pool ?? getCustodyPool();
  await Promise.all(
    tokenIds.map(async (tokenId) => {
      const answer = await resolvePassportCustodyAnswer(tokenId, opts, pgPool);
      out.set(tokenId, answer);
    }),
  );
  return out;
}

/** Attach custody fold fields onto a passport wire row. */
export function attachPassportCustodyAnswer<T extends Record<string, unknown>>(
  row: T,
  answer: PassportCustodyAnswer,
): T & PassportCustodyAnswer {
  return { ...row, ...answer };
}
