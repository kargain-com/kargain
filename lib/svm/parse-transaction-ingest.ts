/**
 * Pure transaction → raw ingest rows (no DB, no RPC).
 */

import {
  decodeProgramDataBase64,
  isLogTruncationSuspect,
  programDataPayloadFromLogLine,
  PROGRAM_DATA_PREFIX,
} from "./program-data-decode";
import {
  lookupEventForProgram,
  splitDiscriminatorAndBody,
} from "./event-discriminators";
import { parseProgramDataFromLogMessages } from "./log-invoke-stack";
import {
  ingestRefusalRowId,
  structuredPayloadRowId,
  type IngestRefusalKind,
} from "./ingest-refusal";
import { contractNameForProgramId } from "./ingest-program-map";
import type { FollowedProgram } from "./ingest-config";

export type StructuredPayloadDraft = {
  id: string;
  namespace: number;
  slot: number;
  txIndexInBlock: number;
  logIndex: number;
  txSignature: string;
  emittingProgram: string;
  discriminator: Buffer;
  eventName: string;
  contractName: string;
  payloadBytes: Buffer;
};

export type IngestRefusalDraft = {
  id: string;
  namespace: number;
  refusalKind: IngestRefusalKind;
  slot: number | null;
  txIndexInBlock: number | null;
  logIndex: number | null;
  txSignature: string | null;
  emittingProgram: string | null;
  discriminator: Buffer | null;
  detail: Record<string, unknown>;
};

export type ParsedTransactionIngest = {
  payloads: StructuredPayloadDraft[];
  refusals: IngestRefusalDraft[];
};

export function parseTransactionForIngest(args: {
  namespace: number;
  slot: number;
  txIndexInBlock: number;
  txSignature: string;
  logMessages: readonly string[] | null | undefined;
  metaErr: unknown;
  followedPrograms: readonly FollowedProgram[];
}): ParsedTransactionIngest {
  const payloads: StructuredPayloadDraft[] = [];
  const refusals: IngestRefusalDraft[] = [];
  const followedSet = new Set(args.followedPrograms.map((p) => p.programId));
  const logs = args.logMessages ?? [];

  if (args.metaErr != null) {
    refusals.push(
      refusalDraft({
        namespace: args.namespace,
        refusalKind: "log_truncated",
        slot: args.slot,
        txIndexInBlock: args.txIndexInBlock,
        logIndex: null,
        txSignature: args.txSignature,
        emittingProgram: null,
        discriminator: null,
        detail: { reason: "transaction_failed", metaErr: String(args.metaErr) },
      }),
    );
    return { payloads, refusals };
  }

  if (isLogTruncationSuspect(logs)) {
    refusals.push(
      refusalDraft({
        namespace: args.namespace,
        refusalKind: "log_truncated",
        slot: args.slot,
        txIndexInBlock: args.txIndexInBlock,
        logIndex: null,
        txSignature: args.txSignature,
        emittingProgram: null,
        discriminator: null,
        detail: {
          reason: "log_budget_exceeded",
          logLineCount: logs.length,
        },
      }),
    );
    return { payloads, refusals };
  }

  const parsed = parseProgramDataFromLogMessages(logs, followedSet);

  for (const obs of parsed.lines) {
    let payloadBytes: Buffer;
    try {
      const encoded = programDataPayloadFromLogLine(obs.sourceLine);
      if (encoded == null) continue;
      payloadBytes = decodeProgramDataBase64(encoded, obs.sourceLine);
    } catch (err) {
      refusals.push(
        refusalDraft({
          namespace: args.namespace,
          refusalKind: "payload_malformed",
          slot: args.slot,
          txIndexInBlock: args.txIndexInBlock,
          logIndex: obs.logIndex,
          txSignature: args.txSignature,
          emittingProgram: obs.emittingProgram,
          discriminator: null,
          detail: {
            reason: err instanceof Error ? err.message : String(err),
            linePrefix: obs.sourceLine.slice(0, 80),
          },
        }),
      );
      continue;
    }

    const split = splitDiscriminatorAndBody(payloadBytes);
    if (!split) {
      refusals.push(
        refusalDraft({
          namespace: args.namespace,
          refusalKind: "payload_malformed",
          slot: args.slot,
          txIndexInBlock: args.txIndexInBlock,
          logIndex: obs.logIndex,
          txSignature: args.txSignature,
          emittingProgram: obs.emittingProgram,
          discriminator: null,
          detail: { reason: "payload_shorter_than_discriminator" },
        }),
      );
      continue;
    }

    const contractName = contractNameForProgramId(
      obs.emittingProgram,
      args.followedPrograms,
    );
    if (!contractName) continue;

    const eventMeta = lookupEventForProgram({
      discriminator: split.discriminator,
      contractName,
    });
    if (!eventMeta) {
      refusals.push(
        refusalDraft({
          namespace: args.namespace,
          refusalKind: "unknown_discriminator",
          slot: args.slot,
          txIndexInBlock: args.txIndexInBlock,
          logIndex: obs.logIndex,
          txSignature: args.txSignature,
          emittingProgram: obs.emittingProgram,
          discriminator: split.discriminator,
          detail: {
            discriminatorHex: split.discriminator.toString("hex"),
            contractName,
          },
        }),
      );
      continue;
    }

    payloads.push({
      id: structuredPayloadRowId({
        namespace: args.namespace,
        slot: args.slot,
        txIndexInBlock: args.txIndexInBlock,
        logIndex: obs.logIndex,
      }),
      namespace: args.namespace,
      slot: args.slot,
      txIndexInBlock: args.txIndexInBlock,
      logIndex: obs.logIndex,
      txSignature: args.txSignature,
      emittingProgram: obs.emittingProgram,
      discriminator: split.discriminator,
      eventName: eventMeta.event,
      contractName: eventMeta.contract,
      payloadBytes,
    });
  }

  return { payloads, refusals };
}

function refusalDraft(args: {
  namespace: number;
  refusalKind: IngestRefusalKind;
  slot: number | null;
  txIndexInBlock: number | null;
  logIndex: number | null;
  txSignature: string | null;
  emittingProgram: string | null;
  discriminator: Buffer | null;
  detail: Record<string, unknown>;
}): IngestRefusalDraft {
  const detailKey = JSON.stringify(args.detail);
  return {
    id: ingestRefusalRowId({
      namespace: args.namespace,
      refusalKind: args.refusalKind,
      slot: args.slot,
      txSignature: args.txSignature,
      logIndex: args.logIndex,
      detailKey,
    }),
    namespace: args.namespace,
    refusalKind: args.refusalKind,
    slot: args.slot,
    txIndexInBlock: args.txIndexInBlock,
    logIndex: args.logIndex,
    txSignature: args.txSignature,
    emittingProgram: args.emittingProgram,
    discriminator: args.discriminator,
    detail: args.detail,
  };
}

/** Scan logs for any Program data line (used in tests). */
export function countProgramDataLines(logMessages: readonly string[]): number {
  return logMessages.filter((l) => l.startsWith(PROGRAM_DATA_PREFIX)).length;
}
