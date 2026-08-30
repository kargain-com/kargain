/**
 * Observable predicates for SVM verifier lifecycle terminals (S5-coverage W4).
 * Sole owner of stake/passport layout reads and ClosePass/ClaimStake/UnbondNotReady asserts
 * used by Devnet prove and the local stand — not a second runner.
 */

/** Matches `STAKE_ACCOUNT_SPACE` in kar-pro-staking `state.rs` (sole size owner). */
export const STAKE_ACCOUNT_SPACE = 128;

/** `KargainError::UnbondNotReady` — append-only code in kargain-errors. */
export const UNBOND_NOT_READY_CUSTOM = 48;

/** Metaplex Core program id (D-17 live-asset owner). */
export const MPL_CORE_PROGRAM_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";

export type DecodedStake = {
  amount: bigint;
  stakedAt: bigint;
  active: boolean;
  unlockAt: bigint;
  verificationFee: bigint;
};

/** StakeAccount: disc8 + wallet32 + amount8 + staked_at8 + active1 + unlock_at8 + fee8 + bump1 */
export function decodeStakeAccount(data: Uint8Array | Buffer): DecodedStake {
  if (data.length < 8 + 32 + 8 + 8 + 1 + 8 + 8) {
    throw new Error(`stake account too short (${data.length})`);
  }
  const view = Buffer.from(data);
  const amount = view.readBigUInt64LE(8 + 32);
  const stakedAt = view.readBigUInt64LE(8 + 32 + 8);
  const active = view[8 + 32 + 8 + 8] !== 0;
  const unlockAt = view.readBigUInt64LE(8 + 32 + 8 + 8 + 1);
  const verificationFee = view.readBigUInt64LE(8 + 32 + 8 + 8 + 1 + 8);
  return { amount, stakedAt, active, unlockAt, verificationFee };
}

export function assertStakeActive(
  data: Uint8Array | Buffer,
  expectActive: boolean,
  label: string,
): DecodedStake {
  const stake = decodeStakeAccount(data);
  if (stake.active !== expectActive) {
    throw new Error(
      `${label}: stake.active=${stake.active} expected ${expectActive}`,
    );
  }
  return stake;
}

/** PassportState: disc8 + token_id32 + status1 + verifier32 … */
export function assertPassportVerified(
  data: Uint8Array | Buffer,
  verifierBytes: Uint8Array | Buffer,
  label: string,
): void {
  if (data.length < 8 + 32 + 1 + 32) {
    throw new Error(`${label}: passport state too short (${data.length})`);
  }
  const view = Buffer.from(data);
  const status = view[8 + 32];
  const onChainVerifier = view.subarray(8 + 32 + 1, 8 + 32 + 1 + 32);
  if (status !== 1) {
    throw new Error(`${label}: status=${status} expected Verified(1)`);
  }
  if (!Buffer.from(verifierBytes).equals(Buffer.from(onChainVerifier))) {
    throw new Error(`${label}: verifier mismatch`);
  }
}

/**
 * D-17: live Core asset = owned by Core with data length > 1.
 * Closed pass = missing account, or Core-owned 1-byte tombstone (or empty).
 */
export function isLiveCoreAsset(account: {
  owner: { toBase58(): string } | string;
  data: Uint8Array | Buffer;
} | null): boolean {
  if (!account) return false;
  const owner =
    typeof account.owner === "string" ? account.owner : account.owner.toBase58();
  return owner === MPL_CORE_PROGRAM_ID && account.data.length > 1;
}

export function assertPassClosed(
  passAsset: {
    owner: { toBase58(): string } | string;
    data: Uint8Array | Buffer;
  } | null,
  stakeData: Uint8Array | Buffer,
  label: string,
): void {
  if (isLiveCoreAsset(passAsset)) {
    throw new Error(
      `${label}: pass asset still live (owner Core, dataLen=${passAsset!.data.length})`,
    );
  }
  const stake = decodeStakeAccount(stakeData);
  if (stake.active) {
    throw new Error(`${label}: stake.active still true after ClosePass (D-21)`);
  }
}

export type ClaimBalances = {
  /** Principal from stake record before claim (D-04 — never from account lamports). */
  amountFromStake: bigint;
  stakeLamportsBefore: number;
  stakeLamportsAfter: number;
  verifierLamportsBefore: number;
  verifierLamportsAfter: number;
  /** Fee paid by the claim transaction (fee payer). */
  txFeeLamports: number;
  /** Rent-exempt minimum for STAKE_ACCOUNT_SPACE (explicit, not a tolerance). */
  rentExemptMin: number;
};

/**
 * After ClaimStake: principal left the stake PDA and arrived at the verifier
 * (fee-adjusted). Stake record cleared; rent remains on the open stake account.
 */
export function assertClaimSettled(b: ClaimBalances, label: string): void {
  if (b.amountFromStake <= 0n) {
    throw new Error(`${label}: amountFromStake must be > 0 before claim`);
  }
  const amount = Number(b.amountFromStake);
  if (!Number.isSafeInteger(amount)) {
    throw new Error(`${label}: amount not safe as number`);
  }

  const stakeDelta = b.stakeLamportsBefore - b.stakeLamportsAfter;
  if (stakeDelta !== amount) {
    throw new Error(
      `${label}: stake lamports delta ${stakeDelta} ≠ amount ${amount} ` +
        `(before=${b.stakeLamportsBefore} after=${b.stakeLamportsAfter})`,
    );
  }

  const verifierExpected =
    b.verifierLamportsBefore - b.txFeeLamports + amount;
  if (b.verifierLamportsAfter !== verifierExpected) {
    throw new Error(
      `${label}: verifier lamports ${b.verifierLamportsAfter} ≠ ` +
        `before(${b.verifierLamportsBefore}) - fee(${b.txFeeLamports}) + amount(${amount}) ` +
        `= ${verifierExpected}`,
    );
  }

  if (b.stakeLamportsAfter < b.rentExemptMin) {
    throw new Error(
      `${label}: stake lamports after ${b.stakeLamportsAfter} < rent-exempt min ${b.rentExemptMin}`,
    );
  }
}

export function assertStakeClearedAfterClaim(
  data: Uint8Array | Buffer,
  label: string,
): DecodedStake {
  const stake = decodeStakeAccount(data);
  if (stake.amount !== 0n) {
    throw new Error(`${label}: stake.amount=${stake.amount} expected 0`);
  }
  if (stake.unlockAt !== 0n) {
    throw new Error(`${label}: stake.unlock_at=${stake.unlockAt} expected 0`);
  }
  if (stake.stakedAt !== 0n) {
    throw new Error(`${label}: stake.staked_at=${stake.stakedAt} expected 0`);
  }
  if (stake.active) {
    throw new Error(`${label}: stake.active still true after claim`);
  }
  return stake;
}

/**
 * Extract Solana `Custom(n)` from a thrown send/confirm error (and nested causes).
 */
export function extractCustomProgramError(err: unknown): number | null {
  const texts: string[] = [];
  const walk = (e: unknown, depth: number) => {
    if (e == null || depth > 6) return;
    if (typeof e === "string") {
      texts.push(e);
      return;
    }
    if (typeof e === "object") {
      const o = e as Record<string, unknown>;
      if (typeof o.message === "string") texts.push(o.message);
      if (o.transactionMessage != null) texts.push(String(o.transactionMessage));
      if (Array.isArray(o.logs)) {
        for (const line of o.logs) texts.push(String(line));
      }
      try {
        texts.push(JSON.stringify(e));
      } catch {
        /* ignore */
      }
      if ("cause" in o) walk(o.cause, depth + 1);
      if ("err" in o) walk(o.err, depth + 1);
    }
  };
  walk(err, 0);
  const blob = texts.join("\n");
  const m =
    /"Custom"\s*:\s*(\d+)/.exec(blob) ||
    /Custom["\s:]+(\d+)/.exec(blob) ||
    /custom program error:\s*0x([0-9a-fA-F]+)/i.exec(blob);
  if (!m) return null;
  if (m[0].toLowerCase().includes("0x")) {
    return Number.parseInt(m[1]!, 16);
  }
  return Number(m[1]);
}

export function assertUnbondNotReady(err: unknown, label: string): void {
  const code = extractCustomProgramError(err);
  if (code !== UNBOND_NOT_READY_CUSTOM) {
    throw new Error(
      `${label}: expected UnbondNotReady Custom(${UNBOND_NOT_READY_CUSTOM}), ` +
        `got custom=${code} err=${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
