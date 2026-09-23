/**
 * Sole stand transaction confirm door.
 *
 * Confirm by signature status against the send’s blockhash window
 * (`lastValidBlockHeight`). Named refuse when the blockhash expires;
 * bounded retry for that case only. Any other failure fails immediately.
 *
 * Stand-local (web3.js) — does not import product kit confirm.
 */

export const STAND_BLOCKHASH_EXPIRED = "stand_blockhash_expired" as const;
export const STAND_TX_FAILED = "stand_tx_failed" as const;
export const STAND_CONFIRM_TIMEOUT = "stand_confirm_timeout" as const;

/** Max resends after a named blockhash expiry (not counting the first attempt). */
export const STAND_BLOCKHASH_EXPIRY_MAX_RETRIES = 2 as const;

export const STAND_CONFIRM_POLL_INTERVAL_MS = 200 as const;
export const STAND_CONFIRM_TIMEOUT_MS = 60_000 as const;

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

/**
 * Poll signature status until confirmed (or stronger).
 * Tip height past lastValidBlockHeight before confirm → stand_blockhash_expired.
 * Signature err → stand_tx_failed (no retry at this layer).
 */
export async function confirmStandSignature(
  args: ConfirmStandSignatureArgs,
): Promise<{ signature: string; slot: bigint }> {
  const {
    signature,
    lastValidBlockHeight,
    ports,
    commitment = "confirmed",
  } = args;
  if (typeof signature !== "string" || signature.length === 0) {
    throw new Error(`${STAND_TX_FAILED}: empty signature`);
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
      throw new Error(
        `${STAND_BLOCKHASH_EXPIRED}: tipHeight=${height} lastValidBlockHeight=${lastValidBlockHeight} ` +
          `blockhash=${args.blockhash}`,
      );
    }

    const [row] = await ports.getSignatureStatuses([signature]);
    if (row?.err) {
      throw new Error(
        `${STAND_TX_FAILED}: signature=${signature} err=${String(row.err)}`,
      );
    }
    const status = row?.confirmationStatus;
    if (status === commitment || status === "finalized") {
      const slotRaw = row?.slot;
      const slot =
        typeof slotRaw === "bigint"
          ? slotRaw
          : typeof slotRaw === "number"
            ? BigInt(slotRaw)
            : 0n;
      return { signature, slot };
    }
    await sleepMs(pollIntervalMs);
  }
  throw new Error(
    `${STAND_CONFIRM_TIMEOUT}: signature=${signature} after ${timeoutMs}ms`,
  );
}

export function isStandBlockhashExpired(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes(STAND_BLOCKHASH_EXPIRED);
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
 * with a fresh send. Other failures never retry.
 */
export async function sendAndConfirmStandWithExpiryRetry(
  args: SendAndConfirmStandArgs,
): Promise<{ signature: string; slot: bigint; attempts: number }> {
  const maxExpiryRetries =
    args.maxExpiryRetries ?? STAND_BLOCKHASH_EXPIRY_MAX_RETRIES;
  let attempts = 0;
  let lastErr: unknown;
  const maxAttempts = 1 + maxExpiryRetries;

  while (attempts < maxAttempts) {
    attempts += 1;
    const sent = await args.sendOnce();
    try {
      const confirmed = await confirmStandSignature({
        signature: sent.signature,
        blockhash: sent.blockhash,
        lastValidBlockHeight: sent.lastValidBlockHeight,
        ports: args.ports,
        commitment: args.commitment,
      });
      return { ...confirmed, attempts };
    } catch (err) {
      lastErr = err;
      if (!isStandBlockhashExpired(err) || attempts >= maxAttempts) {
        throw err;
      }
      // named expiry only → retry with fresh blockhash
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`${STAND_TX_FAILED}: ${String(lastErr)}`);
}

/**
 * Structural connection façade. Accept `any` at the boundary so web3.js
 * Connection (narrow Commitment params) assigns under createRequire.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StandWeb3Connection = any;

export function standConfirmPortsFromConnection(
  conn: StandWeb3Connection,
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

/**
 * Drop-in for web3.js `sendAndConfirmTransaction`: fresh blockhash, send raw,
 * confirm via signature status; bounded retry only on stand_blockhash_expired.
 *
 * Clears prior signatures on each attempt so expiry retry can re-sign.
 */
export async function sendAndConfirmStandTransaction(
  // web3.js Transaction / Keypair — structural any at the createRequire boundary
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conn: StandWeb3Connection,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signers: any[],
  options?: {
    commitment?: "confirmed" | "finalized";
    maxExpiryRetries?: number;
  },
): Promise<string> {
  const commitment = options?.commitment ?? "confirmed";
  const ports = standConfirmPortsFromConnection(conn);
  const result = await sendAndConfirmStandWithExpiryRetry({
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
        skipPreflight: false,
        preflightCommitment: commitment,
      });
      return {
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      };
    },
  });
  return result.signature;
}

/** Confirm an already-sent signature against a known blockhash window. */
export async function confirmStandSentSignature(
  conn: StandWeb3Connection,
  args: {
    signature: string;
    blockhash: string;
    lastValidBlockHeight: number;
    commitment?: "confirmed" | "finalized";
  },
): Promise<void> {
  await confirmStandSignature({
    signature: args.signature,
    blockhash: args.blockhash,
    lastValidBlockHeight: args.lastValidBlockHeight,
    ports: standConfirmPortsFromConnection(conn),
    commitment: args.commitment ?? "confirmed",
  });
}

/**
 * Airdrop + confirm with blockhash window (replaces bare confirmTransaction).
 */
export async function standRequestAirdropAndConfirm(
  conn: StandWeb3Connection,
  pubkey: unknown,
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
