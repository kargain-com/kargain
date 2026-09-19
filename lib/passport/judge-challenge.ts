/**
 * Sole dual-VM owner for the verification challenge `judge` write.
 *
 * Panels call through {@link executeJudgeChallenge} (via `useJudgeChallenge`)
 * and pass the result through `runTx`. Eligibility is owned by the passport
 * action-surface — this owner never re-decides who may judge.
 *
 * First challenge write whose bond_recipient meta must be resolved from chain
 * before send: the program refuses InvalidAccountData when the supplied
 * recipient ≠ disposition (Upheld → challenger; Rejected → forfeit_recipient).
 *
 * Sibling of OpenChallenge / WithdrawChallenge — no shared assembler.
 * Stake is derive-only (program proves qualification); no decodeStakeAccount.
 */

import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import {
  decodeChallengeAccount,
  decodePassportConfig,
} from "@/lib/svm/decode-account-state";
import { encodeSvmInstruction } from "@/lib/svm/encode-instruction";
import { deriveSvmPda } from "@/lib/svm/derive-pda";
import { tokenIdToBytes32 } from "@/lib/svm/event-payload-decode";
import {
  type ActiveAccount,
  type WalletFamilyWanted,
} from "@/lib/web3/active-account";
import {
  commercialActive,
  type CommercialRegistry,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import {
  fetchProductSvmAccountData,
  type FetchSvmAccountDataResult,
} from "@/lib/web3/svm-rpc";
import {
  AccountRole,
  sendSvmInstruction,
  type SvmSignAndSendPort,
  type SvmWriteAccountMeta,
} from "@/lib/web3/svm-write-adapter";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import {
  txWriteAvailabilityForCapability,
  txWriteRefusalMessage,
} from "@/lib/web3/tx-write-availability";

/**
 * Judge outcome ordinal — must match Rust `JudgeOutcome` and Solidity
 * `BondedChallenge.JudgeOutcome`: Upheld = 0, Rejected = 1.
 */
export type JudgeChallengeOutcome = 0 | 1;

export const JUDGE_OUTCOME_UPHELD = 0 as const;
export const JUDGE_OUTCOME_REJECTED = 1 as const;

/** EVM call shape — behavioural pin: judge + [tid, outcome], not payable. */
export type JudgeChallengeEvmCall = {
  address: `0x${string}`;
  abi: typeof KarPassportAbi;
  functionName: "judge";
  args: [bigint, JudgeChallengeOutcome];
  chainId: number;
};

export type JudgeChallengeSvmPlan = {
  programId: string;
  data: Uint8Array;
  accounts: readonly SvmWriteAccountMeta[];
  feePayer: string;
  /** Resolved bond recipient (accounts[5]) — challenger or forfeit. */
  bondRecipient: string;
  outcome: JudgeChallengeOutcome;
};

export type JudgeChallengeCause =
  | "disconnected"
  | "wrong_vm"
  | "unresolved_namespace"
  | "not_in_program"
  | "product_owner_owed"
  | "authority_only"
  | "passport_not_configured"
  | "invalid_token_id"
  | "invalid_outcome"
  | "encode_failed"
  | "pda_failed"
  | "recipient_unresolved"
  | "recipient_decode_failed"
  | "wallet_cannot_sign_and_send"
  | "no_connected_account"
  | "send_failed";

export type PlanJudgeChallengeResult =
  | { ok: true; vm: "evm"; call: JudgeChallengeEvmCall }
  | { ok: true; vm: "svm"; plan: JudgeChallengeSvmPlan }
  | {
      ok: false;
      cause: JudgeChallengeCause;
      detail: string;
      wanted?: WalletFamilyWanted;
    };

export type WriteEvmContractFn = (
  args: JudgeChallengeEvmCall,
) => Promise<`0x${string}`>;

/** Injectable account-data fetch for recipient resolution (tests). */
export type FetchSvmAccountDataFn = (
  account: string,
) => Promise<FetchSvmAccountDataResult>;

export function isJudgeChallengeOutcome(
  value: number,
): value is JudgeChallengeOutcome {
  return value === JUDGE_OUTCOME_UPHELD || value === JUDGE_OUTCOME_REJECTED;
}

/**
 * Build the EVM write args. Sole construction site for the behavioural pin.
 * Do not invent a `value` — judge is not payable. Outcome must be 0 | 1.
 */
export function buildEvmJudgeChallengeCall(args: {
  address: `0x${string}`;
  tokenId: string;
  chainId: number;
  outcome: JudgeChallengeOutcome;
}): JudgeChallengeEvmCall {
  if (!isJudgeChallengeOutcome(args.outcome)) {
    throw new Error(`invalid_outcome:${args.outcome}`);
  }
  return {
    address: args.address,
    abi: KarPassportAbi,
    functionName: "judge",
    args: [BigInt(args.tokenId), args.outcome],
    chainId: wagmiChainId(args.chainId),
  };
}

/**
 * Assemble the nine JudgeChallenge metas in processor order
 * (`entrypoint.rs` judge_challenge): judge, config, asset, state, challenge,
 * bond_recipient, stake, staking_program, payer.
 *
 * Roles from processor facts: judge READONLY_SIGNER (key only); config/asset
 * READONLY; state WRITABLE (save_state); challenge WRITABLE (debit + save);
 * bond_recipient WRITABLE (credit); stake/staking_program READONLY; payer
 * READONLY_SIGNER (is_signer only — no create_pda). Fee-payer writability at
 * the message layer is not this meta's claim.
 */
export function assembleJudgeChallengeAccounts(args: {
  judge: string;
  config: string;
  asset: string;
  state: string;
  challenge: string;
  bondRecipient: string;
  stake: string;
  stakingProgram: string;
  payer: string;
}): SvmWriteAccountMeta[] {
  return [
    { address: args.judge, role: AccountRole.READONLY_SIGNER },
    { address: args.config, role: AccountRole.READONLY },
    { address: args.asset, role: AccountRole.READONLY },
    { address: args.state, role: AccountRole.WRITABLE },
    { address: args.challenge, role: AccountRole.WRITABLE },
    { address: args.bondRecipient, role: AccountRole.WRITABLE },
    { address: args.stake, role: AccountRole.READONLY },
    { address: args.stakingProgram, role: AccountRole.READONLY },
    { address: args.payer, role: AccountRole.READONLY_SIGNER },
  ];
}

export async function planJudgeChallenge(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  outcome: JudgeChallengeOutcome;
  registry?: CommercialRegistry;
  /** Test inject — product path uses live getAccountInfo. */
  fetchAccountData?: FetchSvmAccountDataFn;
}): Promise<PlanJudgeChallengeResult> {
  if (!isJudgeChallengeOutcome(input.outcome)) {
    return {
      ok: false,
      cause: "invalid_outcome",
      detail: `outcome must be 0 (Upheld) or 1 (Rejected); got ${input.outcome}`,
    };
  }

  const avail = txWriteAvailabilityForCapability(input.account, "judge_challenge", input.chainId, input.registry,);
  if (!avail.available) {
    return {
      ok: false,
      cause: avail.cause,
      detail: txWriteRefusalMessage(avail),
      ...(avail.cause === "wrong_vm" ? { wanted: avail.wanted } : {}),
    };
  }

  const stack = commercialActive(input.chainId, input.registry);
  if (stack == null) {
    return {
      ok: false,
      cause: "unresolved_namespace",
      detail: "commercial stack missing after availability admit",
    };
  }

  if (avail.vm === "evm") {
    if (stack.vm !== "evm") {
      return {
        ok: false,
        cause: "wrong_vm",
        detail: "availability/stack vm mismatch",
        wanted: stack.vm,
      };
    }
    const address = karPassportAddress(input.chainId);
    if (address == null) {
      return {
        ok: false,
        cause: "passport_not_configured",
        detail: `no karPassport for chain ${input.chainId}`,
      };
    }
    try {
      const call = buildEvmJudgeChallengeCall({
        address,
        tokenId: input.tokenId,
        chainId: input.chainId,
        outcome: input.outcome,
      });
      return { ok: true, vm: "evm", call };
    } catch (err) {
      return {
        ok: false,
        cause: "invalid_token_id",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (stack.vm !== "svm") {
    return {
      ok: false,
      cause: "wrong_vm",
      detail: "availability/stack vm mismatch",
      wanted: stack.vm,
    };
  }

  return planSvmJudgeChallenge({
    stack,
    account: input.account,
    tokenId: input.tokenId,
    outcome: input.outcome,
    fetchAccountData: input.fetchAccountData ?? fetchProductSvmAccountData,
  });
}

/**
 * Resolve bond_recipient for the chosen outcome — one keyed-read arm only.
 * Upheld → ChallengeAccount.challenger; Rejected → PassportConfig.forfeitRecipient.
 * Absence / decode failure → named refusal (never invent).
 */
async function resolveBondRecipient(args: {
  outcome: JudgeChallengeOutcome;
  challengeAddress: string;
  configAddress: string;
  fetchAccountData: FetchSvmAccountDataFn;
}): Promise<
  | { ok: true; recipient: string }
  | { ok: false; cause: JudgeChallengeCause; detail: string }
> {
  if (args.outcome === JUDGE_OUTCOME_UPHELD) {
    const fetched = await args.fetchAccountData(args.challengeAddress);
    if (!fetched.ok) {
      return {
        ok: false,
        cause: "recipient_unresolved",
        detail: `challenge:${fetched.cause}:${fetched.detail}`,
      };
    }
    const decoded = decodeChallengeAccount(fetched.value);
    if (!decoded.ok) {
      return {
        ok: false,
        cause: "recipient_decode_failed",
        detail: `challenge:${decoded.cause}:${decoded.detail}`,
      };
    }
    return { ok: true, recipient: decoded.value.challenger };
  }

  const fetched = await args.fetchAccountData(args.configAddress);
  if (!fetched.ok) {
    return {
      ok: false,
      cause: "recipient_unresolved",
      detail: `config:${fetched.cause}:${fetched.detail}`,
    };
  }
  const decoded = decodePassportConfig(fetched.value);
  if (!decoded.ok) {
    return {
      ok: false,
      cause: "recipient_decode_failed",
      detail: `config:${decoded.cause}:${decoded.detail}`,
    };
  }
  return { ok: true, recipient: decoded.value.forfeitRecipient };
}

async function planSvmJudgeChallenge(args: {
  stack: SvmCommercialActiveStack;
  account: ActiveAccount;
  tokenId: string;
  outcome: JudgeChallengeOutcome;
  fetchAccountData: FetchSvmAccountDataFn;
}): Promise<PlanJudgeChallengeResult> {
  if (args.account.status !== "connected" || args.account.vm !== "svm") {
    return {
      ok: false,
      cause: "wrong_vm",
      detail: "SVM plan requires connected SVM session",
      wanted: "svm",
    };
  }

  let tokenBytes: Uint8Array;
  try {
    tokenBytes = tokenIdToBytes32(args.tokenId);
  } catch (err) {
    return {
      ok: false,
      cause: "invalid_token_id",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const encoded = encodeSvmInstruction({
    program: "kar-passport",
    variant: "JudgeChallenge",
    fields: {
      token_id: tokenBytes,
      outcome: args.outcome,
    },
  });
  if (!encoded.ok) {
    return {
      ok: false,
      cause: "encode_failed",
      detail: `${encoded.cause}:${encoded.detail}`,
    };
  }

  const programId = args.stack.karPassport;
  const stakingProgramId = args.stack.karProStaking;
  // One wallet: judge (signer) and payer (signer) — same pubkey in two slots.
  const wallet = args.account.address;

  const [configPda, assetPda, statePda, challengePda, stakePda] =
    await Promise.all([
      deriveSvmPda({ recipe: "kar-passport/config", programId }),
      deriveSvmPda({
        recipe: "kar-passport/asset",
        programId,
        seeds: { token_id: tokenBytes },
      }),
      deriveSvmPda({
        recipe: "kar-passport/state",
        programId,
        seeds: { token_id: tokenBytes },
      }),
      deriveSvmPda({
        recipe: "kargain-bonded-challenge/challenge",
        programId,
        seeds: { subject_id: tokenBytes },
      }),
      deriveSvmPda({
        recipe: "kar-pro-staking/stake",
        programId: stakingProgramId,
        seeds: { verifier: wallet },
      }),
    ]);

  for (const pda of [configPda, assetPda, statePda, challengePda, stakePda]) {
    if (!pda.ok) {
      return {
        ok: false,
        cause: "pda_failed",
        detail: `${pda.cause}:${pda.detail}`,
      };
    }
  }
  if (
    !configPda.ok ||
    !assetPda.ok ||
    !statePda.ok ||
    !challengePda.ok ||
    !stakePda.ok
  ) {
    return { ok: false, cause: "pda_failed", detail: "unreachable" };
  }

  const recipient = await resolveBondRecipient({
    outcome: args.outcome,
    challengeAddress: challengePda.address,
    configAddress: configPda.address,
    fetchAccountData: args.fetchAccountData,
  });
  if (!recipient.ok) {
    return {
      ok: false,
      cause: recipient.cause,
      detail: recipient.detail,
    };
  }

  const accounts = assembleJudgeChallengeAccounts({
    judge: wallet,
    config: configPda.address,
    asset: assetPda.address,
    state: statePda.address,
    challenge: challengePda.address,
    bondRecipient: recipient.recipient,
    stake: stakePda.address,
    stakingProgram: stakingProgramId,
    payer: wallet,
  });

  return {
    ok: true,
    vm: "svm",
    plan: {
      programId,
      data: encoded.data,
      accounts,
      feePayer: wallet,
      bondRecipient: recipient.recipient,
      outcome: args.outcome,
    },
  };
}

export async function executeJudgeChallenge(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  outcome: JudgeChallengeOutcome;
  writeEvmContract: WriteEvmContractFn;
  registry?: CommercialRegistry;
  svmPort?: SvmSignAndSendPort;
  fetchBlockhash?: Parameters<typeof sendSvmInstruction>[0]["fetchBlockhash"];
  fetchAccountData?: FetchSvmAccountDataFn;
}): Promise<string> {
  const planned = await planJudgeChallenge({
    account: input.account,
    chainId: input.chainId,
    tokenId: input.tokenId,
    outcome: input.outcome,
    registry: input.registry,
    fetchAccountData: input.fetchAccountData,
  });
  if (!planned.ok) {
    throw new Error(
      planned.detail.length > 0
        ? planned.detail
        : `judgeChallenge refused: ${planned.cause}`,
    );
  }

  if (planned.vm === "evm") {
    return input.writeEvmContract(planned.call);
  }

  if (input.svmPort == null) {
    throw new Error("judgeChallenge refused: no_connected_account");
  }

  const stack = commercialActive(input.chainId, input.registry);
  if (stack == null || stack.vm !== "svm") {
    throw new Error("judgeChallenge refused: unresolved_namespace");
  }

  const sent = await sendSvmInstruction({
    stack,
    programId: planned.plan.programId,
    data: planned.plan.data,
    accounts: planned.plan.accounts,
    feePayer: planned.plan.feePayer,
    port: input.svmPort,
    fetchBlockhash: input.fetchBlockhash,
  });
  if (!sent.ok) {
    throw new Error(`judgeChallenge refused: ${sent.cause}:${sent.detail}`);
  }
  return sent.signature;
}
