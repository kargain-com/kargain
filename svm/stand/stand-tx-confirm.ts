/**
 * Sole stand transaction confirm door.
 *
 * Confirm by signature status against the send’s blockhash window
 * (`lastValidBlockHeight`). Returns a typed {@link StandConfirmOutcome} —
 * never throws for signature err / expiry / timeout. Happy-path facades
 * map non-ok outcomes to named throws; expected-refusal facades return the
 * outcome so the refusal owner reads structured InstructionError only.
 *
 * Stand-local (web3.js) — does not import product kit confirm.
 */

import type {
  StandConnection,
  StandKeypair,
  StandTransaction,
} from "./solana-web3-types.ts";

export const STAND_BLOCKHASH_EXPIRED = "stand_blockhash_expired" as const;
export const STAND_TX_FAILED = "stand_tx_failed" as const;
export const STAND_CONFIRM_TIMEOUT = "stand_confirm_timeout" as const;

/** Max resends after a named blockhash expiry (not counting the first attempt). */
export const STAND_BLOCKHASH_EXPIRY_MAX_RETRIES = 2 as const;

export const STAND_CONFIRM_POLL_INTERVAL_MS = 200 as const;
export const STAND_CONFIRM_TIMEOUT_MS = 60_000 as const;

/**
 * Structural TransactionError from signature status `err`.
 * Refusal parse accepts InstructionError only; unknown shapes fail closed.
 */
export type StandTransactionError = {
  InstructionError?: [number, string | { Custom: number } | unknown];
  [key: string]: unknown;
};

export type StandConfirmOutcome =
  | { kind: "landed_ok"; signature: string; slot: bigint }
  | {
      kind: "landed_with_error";
      signature: string;
      err: StandTransactionError;
    }
  | {
      kind: "stand_blockhash_expired";
      tipHeight: number;
      lastValidBlockHeight: number;
      blockhash: string;
    }
  | {
      kind: "stand_confirm_timeout";
      signature: string;
      timeoutMs: number;
    }
  | { kind: "stand_tx_failed"; detail: string };

export type StandSignatureStatusRow = {
  confirmationStatus?: string | null;
  err?: unknown;
  slot?: number | bigint | null;
} | null;

export type StandConfirmPorts = {
  getSignatureStatuses: (
    signatures: string[],
  ) => Promise<ReadonlyArray<StandSignatureStatusRow>>;
  getBlockHeight: () => Promise<number>;
  /** Optional clock for tests; defaults to Date.now. */
  nowMs?: () => number;
  /** Optional sleep for tests; defaults to setTimeout. */
  sleepMs?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

export type ConfirmStandSignatureArgs = {
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
  ports: StandConfirmPorts;
  commitment?: "confirmed" | "finalized";
};

function slotFromRow(row: StandSignatureStatusRow): bigint {
  const slotRaw = row?.slot;
  if (typeof slotRaw === "bigint") return slotRaw;
  if (typeof slotRaw === "number") return BigInt(slotRaw);
  return 0n;
}

function asStandTransactionError(err: unknown): StandTransactionError {
  if (err != null && typeof err === "object") {
    return err as StandTransactionError;
  }
  return { raw: err };
}

/**
 * Poll signature status until confirmed (or stronger).
 * Tip past lastValidBlockHeight → stand_blockhash_expired.
 * Signature err → landed_with_error (raw err; no stringify/reparse).
 */
export async function confirmStandSignature(
  args: ConfirmStandSignatureArgs,
): Promise<StandConfirmOutcome> {
  const {
    signature,
    lastValidBlockHeight,
    ports,
    commitment = "confirmed",
  } = args;
  if (typeof signature !== "string" || signature.length === 0) {
    return { kind: "stand_tx_failed", detail: "empty signature" };
  }
  const nowMs = ports.nowMs ?? (() => Date.now());
  const sleepMs =
    ports.sleepMs ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const pollIntervalMs = ports.pollIntervalMs ?? STAND_CONFIRM_POLL_INTERVAL_MS;
  const timeoutMs = ports.timeoutMs ?? STAND_CONFIRM_TIMEOUT_MS;
  const deadline = nowMs() + timeoutMs;

  while (nowMs() < deadline) {
    const height = await ports.getBlockHeight();
    if (height > lastValidBlockHeight) {
      return {
        kind: "stand_blockhash_expired",
        tipHeight: height,
        lastValidBlockHeight,
        blockhash: args.blockhash,
      };
    }

    const [row] = await ports.getSignatureStatuses([signature]);
    if (row?.err) {
      return {
        kind: "landed_with_error",
        signature,
        err: asStandTransactionError(row.err),
      };
    }
    const status = row?.confirmationStatus;
    if (status === commitment || status === "finalized") {
      return {
        kind: "landed_ok",
        signature,
        slot: slotFromRow(row),
      };
    }
    await sleepMs(pollIntervalMs);
  }
  return {
    kind: "stand_confirm_timeout",
    signature,
    timeoutMs,
  };
}

/** True when a thrown Error (happy facade) names blockhash expiry. */
export function isStandBlockhashExpired(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes(STAND_BLOCKHASH_EXPIRED);
}

export function isStandBlockhashExpiredOutcome(
  outcome: StandConfirmOutcome,
): boolean {
  return outcome.kind === "stand_blockhash_expired";
}

/** Format a non-ok outcome as the historical throw message for happy-path facades. */
export function standConfirmOutcomeThrowMessage(
  outcome: StandConfirmOutcome,
): string {
  switch (outcome.kind) {
    case "landed_ok":
      return `${STAND_TX_FAILED}: unexpected landed_ok in throw mapper`;
    case "landed_with_error": {
      const errBlob = JSON.stringify(outcome.err);
      return `${STAND_TX_FAILED}: signature=${outcome.signature} err=${errBlob}`;
    }
    case "stand_blockhash_expired":
      return (
        `${STAND_BLOCKHASH_EXPIRED}: tipHeight=${outcome.tipHeight} ` +
        `lastValidBlockHeight=${outcome.lastValidBlockHeight} blockhash=${outcome.blockhash}`
      );
    case "stand_confirm_timeout":
      return `${STAND_CONFIRM_TIMEOUT}: signature=${outcome.signature} after ${outcome.timeoutMs}ms`;
    case "stand_tx_failed":
      return `${STAND_TX_FAILED}: ${outcome.detail}`;
  }
}

export type SendStandAttempt = {
  blockhash: string;
  lastValidBlockHeight: number;
  signature: string;
};

export type SendAndConfirmStandArgs = {
  /** Build+send one attempt with a fresh blockhash; return signature + window. */
  sendOnce: () => Promise<SendStandAttempt>;
  ports: StandConfirmPorts;
  commitment?: "confirmed" | "finalized";
  /** Extra attempts after the first when only blockhash expires. */
  maxExpiryRetries?: number;
};

/**
 * Send once, confirm; on stand_blockhash_expired only, retry ≤ maxExpiryRetries
 * with a fresh send. Other outcomes return immediately (no retry).
 */
export async function sendAndConfirmStandWithExpiryRetry(
  args: SendAndConfirmStandArgs,
): Promise<StandConfirmOutcome & { attempts: number }> {
  const maxExpiryRetries =
    args.maxExpiryRetries ?? STAND_BLOCKHASH_EXPIRY_MAX_RETRIES;
  let attempts = 0;
  let lastOutcome: StandConfirmOutcome = {
    kind: "stand_tx_failed",
    detail: "no attempt",
  };
  const maxAttempts = 1 + maxExpiryRetries;

  while (attempts < maxAttempts) {
    attempts += 1;
    const sent = await args.sendOnce();
    const outcome = await confirmStandSignature({
      signature: sent.signature,
      blockhash: sent.blockhash,
      lastValidBlockHeight: sent.lastValidBlockHeight,
      ports: args.ports,
      commitment: args.commitment,
    });
    lastOutcome = outcome;
    if (outcome.kind === "landed_ok" || outcome.kind === "landed_with_error") {
      return { ...outcome, attempts };
    }
    if (
      outcome.kind !== "stand_blockhash_expired" ||
      attempts >= maxAttempts
    ) {
      return { ...outcome, attempts };
    }
  }
  return { ...lastOutcome, attempts };
}

export function standConfirmPortsFromConnection(
  conn: StandConnection,
  overrides?: Partial<StandConfirmPorts>,
): StandConfirmPorts {
  return {
    getSignatureStatuses: async (signatures) => {
      const { value } = await conn.getSignatureStatuses(signatures, {
        searchTransactionHistory: true,
      });
      return value;
    },
    getBlockHeight: () => conn.getBlockHeight("confirmed"),
    ...overrides,
  };
}

type SendStandTransactionOptions = {
  commitment?: "confirmed" | "finalized";
  maxExpiryRetries?: number;
  skipPreflight?: boolean;
};

async function sendStandTransactionCore(
  conn: StandConnection,
  transaction: StandTransaction,
  signers: StandKeypair[],
  options: SendStandTransactionOptions | undefined,
): Promise<StandConfirmOutcome & { attempts: number }> {
  const commitment = options?.commitment ?? "confirmed";
  const skipPreflight = options?.skipPreflight ?? false;
  const ports = standConfirmPortsFromConnection(conn);
  return sendAndConfirmStandWithExpiryRetry({
    commitment,
    maxExpiryRetries: options?.maxExpiryRetries,
    ports,
    sendOnce: async () => {
      if (Array.isArray(transaction.signatures)) {
        transaction.signatures = [];
      }
      if (transaction.feePayer == null && signers[0] != null) {
        transaction.feePayer = signers[0].publicKey;
      }
      const latest = await conn.getLatestBlockhash(commitment);
      transaction.recentBlockhash = latest.blockhash;
      for (const s of signers) {
        transaction.partialSign(s);
      }
      const raw = transaction.serialize();
      const signature = await conn.sendRawTransaction(raw, {
        skipPreflight,
        preflightCommitment: commitment,
      });
      return {
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      };
    },
  });
}

/**
 * Drop-in for web3.js `sendAndConfirmTransaction`: fresh blockhash, send raw
 * (preflight on), confirm via signature status; bounded retry only on
 * stand_blockhash_expired. Non-ok outcomes throw named Errors.
 */
export async function sendAndConfirmStandTransaction(
  conn: StandConnection,
  transaction: StandTransaction,
  signers: StandKeypair[],
  options?: {
    commitment?: "confirmed" | "finalized";
    maxExpiryRetries?: number;
  },
): Promise<string> {
  const outcome = await sendStandTransactionCore(conn, transaction, signers, {
    ...options,
    skipPreflight: false,
  });
  if (outcome.kind === "landed_ok") {
    return outcome.signature;
  }
  throw new Error(standConfirmOutcomeThrowMessage(outcome));
}

/**
 * Expected-refusal send: skipPreflight, return typed confirm outcome
 * (InstructionError from signature status — never simulation prose).
 */
export async function sendAndConfirmStandTransactionForRefusal(
  conn: StandConnection,
  transaction: StandTransaction,
  signers: StandKeypair[],
  options?: {
    commitment?: "confirmed" | "finalized";
    maxExpiryRetries?: number;
  },
): Promise<StandConfirmOutcome> {
  const { attempts: _attempts, ...outcome } = await sendStandTransactionCore(
    conn,
    transaction,
    signers,
    { ...options, skipPreflight: true },
  );
  return outcome;
}

/** Confirm an already-sent signature against a known blockhash window. */
export async function confirmStandSentSignature(
  conn: StandConnection,
  args: {
    signature: string;
    blockhash: string;
    lastValidBlockHeight: number;
    commitment?: "confirmed" | "finalized";
  },
): Promise<void> {
  const outcome = await confirmStandSignature({
    signature: args.signature,
    blockhash: args.blockhash,
    lastValidBlockHeight: args.lastValidBlockHeight,
    ports: standConfirmPortsFromConnection(conn),
    commitment: args.commitment ?? "confirmed",
  });
  if (outcome.kind !== "landed_ok") {
    throw new Error(standConfirmOutcomeThrowMessage(outcome));
  }
}

/**
 * Airdrop + confirm with blockhash window (replaces bare confirmTransaction).
 */
export async function standRequestAirdropAndConfirm(
  conn: StandConnection,
  pubkey: StandKeypair["publicKey"],
  lamports: number,
): Promise<string> {
  const latest = await conn.getLatestBlockhash("confirmed");
  const signature = await conn.requestAirdrop(pubkey, lamports);
  await confirmStandSentSignature(conn, {
    signature,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  });
  return signature;
}
