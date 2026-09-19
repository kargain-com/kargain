/**
 * Sole dual-VM owner for the verification challenge `withdraw` write.
 *
 * Panels call through {@link executeWithdrawChallenge} (via
 * `useWithdrawChallenge`) and pass the result through `runTx`. Eligibility is
 * owned by the passport action-surface — this owner never re-decides it.
 *
 * VM fork lives here only. SVM assembly needs a fresh PassportState read every
 * time: `on_withdrawn` always appends a record, so the record PDA is keyed at
 * the live `record_count` (U6.3 race on a money path). Sibling of OpenChallenge
 * / AppendRecord — no shared assembler.
 *
 * Challenger and payer are the same connected wallet in two meta slots: one
 * wallet is both the bond recipient (`transfer_bond` credits challenger) and
 * the rent payer for the dispute-withdrawn record PDA — locked Q2.
 */

import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { decodePassportState } from "@/lib/svm/decode-account-state";
import { encodeSvmInstruction } from "@/lib/svm/encode-instruction";
import { deriveSvmPda } from "@/lib/svm/derive-pda";
import { tokenIdToBytes32 } from "@/lib/svm/event-payload-decode";
import { systemProgramId } from "@/lib/svm/foreign-programs";
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

/** EVM call shape — behavioural pin: withdraw + [BigInt(tokenId)], not payable. */
export type WithdrawChallengeEvmCall = {
  address: `0x${string}`;
  abi: typeof KarPassportAbi;
  functionName: "withdraw";
  args: [bigint];
  chainId: number;
};

export type WithdrawChallengeSvmPlan = {
  programId: string;
  data: Uint8Array;
  accounts: readonly SvmWriteAccountMeta[];
  feePayer: string;
  /** Decoded index used for the record PDA — fresh every assembly. */
  recordCount: number;
};

export type WithdrawChallengeCause =
  | "disconnected"
  | "wrong_vm"
  | "unresolved_namespace"
  | "not_in_program"
  | "product_owner_owed"
  | "authority_only"
  | "passport_not_configured"
  | "invalid_token_id"
  | "encode_failed"
  | "pda_failed"
  | "state_unavailable"
  | "state_decode_failed"
  | "wallet_cannot_sign_and_send"
  | "no_connected_account"
  | "send_failed";

export type PlanWithdrawChallengeResult =
  | { ok: true; vm: "evm"; call: WithdrawChallengeEvmCall }
  | { ok: true; vm: "svm"; plan: WithdrawChallengeSvmPlan }
  | {
      ok: false;
      cause: WithdrawChallengeCause;
      detail: string;
      wanted?: WalletFamilyWanted;
    };

export type WriteEvmContractFn = (
  args: WithdrawChallengeEvmCall,
) => Promise<`0x${string}`>;

/** Injectable account-data fetch for freshness proofs (tests). */
export type FetchSvmAccountDataFn = (
  account: string,
) => Promise<FetchSvmAccountDataResult>;

/**
 * Build the EVM write args. Sole construction site for the behavioural pin.
 * Do not invent a `value` — withdraw is not payable.
 */
export function buildEvmWithdrawChallengeCall(args: {
  address: `0x${string}`;
  tokenId: string;
  chainId: number;
}): WithdrawChallengeEvmCall {
  return {
    address: args.address,
    abi: KarPassportAbi,
    functionName: "withdraw",
    args: [BigInt(args.tokenId)],
    chainId: wagmiChainId(args.chainId),
  };
}

/**
 * Assemble the eight WithdrawChallenge metas in processor order
 * (`entrypoint.rs` withdraw_challenge): challenger, config, asset, state,
 * challenge, record, system, payer.
 *
 * Roles from processor facts: challenger WRITABLE_SIGNER (signer + bond
 * credit); config/asset READONLY; state WRITABLE; challenge WRITABLE (debit +
 * save); record WRITABLE (append); system READONLY; payer WRITABLE_SIGNER
 * (record rent). Challenger and payer are the same pubkey.
 */
export function assembleWithdrawChallengeAccounts(args: {
  challenger: string;
  config: string;
  asset: string;
  state: string;
  challenge: string;
  record: string;
  system: string;
  payer: string;
}): SvmWriteAccountMeta[] {
  return [
    { address: args.challenger, role: AccountRole.WRITABLE_SIGNER },
    { address: args.config, role: AccountRole.READONLY },
    { address: args.asset, role: AccountRole.READONLY },
    { address: args.state, role: AccountRole.WRITABLE },
    { address: args.challenge, role: AccountRole.WRITABLE },
    { address: args.record, role: AccountRole.WRITABLE },
    { address: args.system, role: AccountRole.READONLY },
    { address: args.payer, role: AccountRole.WRITABLE_SIGNER },
  ];
}

export async function planWithdrawChallenge(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  registry?: CommercialRegistry;
  /** Test inject — product path uses live getAccountInfo. */
  fetchAccountData?: FetchSvmAccountDataFn;
}): Promise<PlanWithdrawChallengeResult> {
  const avail = txWriteAvailabilityForCapability(input.account, "withdraw_challenge", input.chainId, input.registry,);
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
      const call = buildEvmWithdrawChallengeCall({
        address,
        tokenId: input.tokenId,
        chainId: input.chainId,
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

  return planSvmWithdrawChallenge({
    stack,
    account: input.account,
    tokenId: input.tokenId,
    fetchAccountData: input.fetchAccountData ?? fetchProductSvmAccountData,
  });
}

async function planSvmWithdrawChallenge(args: {
  stack: SvmCommercialActiveStack;
  account: ActiveAccount;
  tokenId: string;
  fetchAccountData: FetchSvmAccountDataFn;
}): Promise<PlanWithdrawChallengeResult> {
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
    variant: "WithdrawChallenge",
    fields: {
      token_id: tokenBytes,
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
  // One wallet: bond recipient (challenger) and record PDA rent payer.
  const wallet = args.account.address;

  const [configPda, assetPda, statePda, challengePda] = await Promise.all([
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
  ]);

  for (const pda of [configPda, assetPda, statePda, challengePda]) {
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
    !challengePda.ok
  ) {
    return { ok: false, cause: "pda_failed", detail: "unreachable" };
  }

  // Fresh read every assembly — record index lives only in state.
  const fetched = await args.fetchAccountData(statePda.address);
  if (!fetched.ok) {
    return {
      ok: false,
      cause: "state_unavailable",
      detail: `${fetched.cause}:${fetched.detail}`,
    };
  }

  const decoded = decodePassportState(fetched.value);
  if (!decoded.ok) {
    return {
      ok: false,
      cause: "state_decode_failed",
      detail: `${decoded.cause}:${decoded.detail}`,
    };
  }

  const recordCount = decoded.value.recordCount;
  const recordPda = await deriveSvmPda({
    recipe: "kar-passport/record",
    programId,
    seeds: { token_id: tokenBytes, index: recordCount },
  });
  if (!recordPda.ok) {
    return {
      ok: false,
      cause: "pda_failed",
      detail: `${recordPda.cause}:${recordPda.detail}`,
    };
  }

  const accounts = assembleWithdrawChallengeAccounts({
    challenger: wallet,
    config: configPda.address,
    asset: assetPda.address,
    state: statePda.address,
    challenge: challengePda.address,
    record: recordPda.address,
    system: systemProgramId(),
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
      recordCount,
    },
  };
}

export async function executeWithdrawChallenge(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  writeEvmContract: WriteEvmContractFn;
  registry?: CommercialRegistry;
  svmPort?: SvmSignAndSendPort;
  fetchBlockhash?: Parameters<typeof sendSvmInstruction>[0]["fetchBlockhash"];
  fetchAccountData?: FetchSvmAccountDataFn;
}): Promise<string> {
  const planned = await planWithdrawChallenge({
    account: input.account,
    chainId: input.chainId,
    tokenId: input.tokenId,
    registry: input.registry,
    fetchAccountData: input.fetchAccountData,
  });
  if (!planned.ok) {
    throw new Error(
      planned.detail.length > 0
        ? planned.detail
        : `withdrawChallenge refused: ${planned.cause}`,
    );
  }

  if (planned.vm === "evm") {
    return input.writeEvmContract(planned.call);
  }

  if (input.svmPort == null) {
    throw new Error("withdrawChallenge refused: no_connected_account");
  }

  const stack = commercialActive(input.chainId, input.registry);
  if (stack == null || stack.vm !== "svm") {
    throw new Error("withdrawChallenge refused: unresolved_namespace");
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
    throw new Error(`withdrawChallenge refused: ${sent.cause}:${sent.detail}`);
  }
  return sent.signature;
}
