/**
 * Sole named source for Devnet mode InitConfig parameters.
 * Values are explicit inputs + named constants — not role reuse or script digits.
 */
import {
  ASCENDING_CHALLENGE_WINDOW,
  MARKETPLACE_FEE_BPS,
} from "./verify-constructor-args.ts";
import { resolveSolanaForfeitRecipient } from "./svm-deploy-plan.ts";

/** Ascending challenge bond on SVM (lamports). Weight class ≈ passport dispute; not EVM wei. */
export const SVM_ASCENDING_CHALLENGE_BOND_LAMPORTS = 1_000_000n;

export type ModeInitParamsCause =
  | "missing_platform_recipient"
  | "missing_forfeit_recipient"
  | "missing_guardian"
  | "guardian_equals_authority"
  | "platform_equals_forfeit_without_ack";

export class ModeInitParamsRefusal extends Error {
  readonly cause: ModeInitParamsCause;
  constructor(cause: ModeInitParamsCause, detail?: string) {
    super(detail ?? cause);
    this.name = "ModeInitParamsRefusal";
    this.cause = cause;
  }
}

export type ModeInitParamsInput = {
  /** Config authority pubkey (base58) — guardian must differ. */
  authority: string;
  /** When true, platform === forfeit is allowed and the run must print the ack. */
  allowPlatformEqualsForfeit: boolean;
  env?: NodeJS.ProcessEnv;
};

export type ModeInitParams = {
  platformRecipient: string;
  forfeitRecipient: string;
  guardian: string;
  platformFeeBps: number;
  challengeBondLamports: bigint;
  challengeWindowSeconds: bigint;
  /** True when platform === forfeit and the caller explicitly allowed it. */
  platformEqualsForfeitAcknowledged: boolean;
};

function requireEnvAddress(
  env: NodeJS.ProcessEnv,
  key: "SOLANA_PLATFORM_RECIPIENT" | "SOLANA_GUARDIAN",
  missing: ModeInitParamsCause,
): string {
  const raw = env[key]?.trim();
  if (!raw) {
    throw new ModeInitParamsRefusal(missing, `${key} is required (public base58; no default)`);
  }
  return raw;
}

/**
 * Resolve InitConfig role + numeric parameters.
 * Platform and forfeit are separate env inputs; equal addresses require
 * `allowPlatformEqualsForfeit`. Guardian must not equal authority.
 */
export function resolveModeInitParams(input: ModeInitParamsInput): ModeInitParams {
  const env = input.env ?? process.env;
  const platformRecipient = requireEnvAddress(
    env,
    "SOLANA_PLATFORM_RECIPIENT",
    "missing_platform_recipient",
  );
  let forfeitRecipient: string;
  try {
    forfeitRecipient = resolveSolanaForfeitRecipient(env);
  } catch {
    throw new ModeInitParamsRefusal(
      "missing_forfeit_recipient",
      "SOLANA_FORFEIT_RECIPIENT is required (public base58; no default)",
    );
  }
  const guardian = requireEnvAddress(env, "SOLANA_GUARDIAN", "missing_guardian");

  if (guardian === input.authority) {
    throw new ModeInitParamsRefusal(
      "guardian_equals_authority",
      "SOLANA_GUARDIAN must differ from InitConfig authority (EVM posture)",
    );
  }

  const same = platformRecipient === forfeitRecipient;
  if (same && !input.allowPlatformEqualsForfeit) {
    throw new ModeInitParamsRefusal(
      "platform_equals_forfeit_without_ack",
      "platform and forfeit match; pass --allow-platform-equals-forfeit to acknowledge",
    );
  }

  return {
    platformRecipient,
    forfeitRecipient,
    guardian,
    platformFeeBps: Number(MARKETPLACE_FEE_BPS),
    challengeBondLamports: SVM_ASCENDING_CHALLENGE_BOND_LAMPORTS,
    challengeWindowSeconds: ASCENDING_CHALLENGE_WINDOW,
    platformEqualsForfeitAcknowledged: same && input.allowPlatformEqualsForfeit,
  };
}

/** One-line ack printed when fee sink ≡ forfeit by explicit caller choice. */
export function platformEqualsForfeitAckLine(params: ModeInitParams): string | null {
  if (!params.platformEqualsForfeitAcknowledged) return null;
  return `platform_equals_forfeit acknowledged ${params.platformRecipient}`;
}
