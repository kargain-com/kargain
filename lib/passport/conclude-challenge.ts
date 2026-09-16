/**
 * Sole dual-VM owner for the verification challenge `conclude` write.
 *
 * Panels call through {@link executeConcludeChallenge} (via
 * `useConcludeChallenge`) and pass the result through `runTx`. Eligibility is
 * owned by the passport action-surface — this owner never re-decides who may
 * conclude.
 *
 * Permissionless after the window: the processor checks only `payer.is_signer`
 * — no judge, challenger, or stake. bond_recipient must equal
 * `config.forfeit_recipient` (keyed config decode only); mismatch →
 * InvalidAccountData.
 *
 * Sibling of OpenChallenge / WithdrawChallenge / JudgeChallenge — no shared
 * assembler. No create_pda → payer is READONLY_SIGNER (same derivation as
 * JudgeChallenge payer, not open/withdraw rent payers).
 */

import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { decodePassportConfig } from "@/lib/svm/decode-account-state";
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
  txWriteAvailability,
  txWriteRefusalMessage,
} from "@/lib/web3/tx-write-availability";

/** EVM call shape — behavioural pin: conclude + [tid], not payable. */
export type ConcludeChallengeEvmCall = {
  address: `0x${string}`;
  abi: typeof KarPassportAbi;
  functionName: "conclude";
  args: [bigint];
  chainId: number;
};

export type ConcludeChallengeSvmPlan = {
  programId: string;
  data: Uint8Array;
  accounts: readonly SvmWriteAccountMeta[];
  feePayer: string;
  /** Resolved bond recipient (accounts[4]) — always forfeit from config. */
  bondRecipient: string;
};

export type ConcludeChallengeCause =
  | "disconnected"
  | "wrong_vm"
  | "unresolved_namespace"
  | "passport_not_configured"
  | "invalid_token_id"
  | "encode_failed"
  | "pda_failed"
  | "recipient_unresolved"
  | "recipient_decode_failed"
  | "wallet_cannot_sign_and_send"
  | "no_connected_account"
  | "send_failed";

export type PlanConcludeChallengeResult =
  | { ok: true; vm: "evm"; call: ConcludeChallengeEvmCall }
  | { ok: true; vm: "svm"; plan: ConcludeChallengeSvmPlan }
  | {
      ok: false;
      cause: ConcludeChallengeCause;
      detail: string;
      wanted?: WalletFamilyWanted;
    };

export type WriteEvmContractFn = (
  args: ConcludeChallengeEvmCall,
) => Promise<`0x${string}`>;

/** Injectable account-data fetch for recipient resolution (tests). */
export type FetchSvmAccountDataFn = (
  account: string,
) => Promise<FetchSvmAccountDataResult>;

/**
 * Build the EVM write args. Sole construction site for the behavioural pin.
 * Do not invent a `value` — conclude is not payable. Exactly one argument.
 */
export function buildEvmConcludeChallengeCall(args: {
  address: `0x${string}`;
  tokenId: string;
  chainId: number;
}): ConcludeChallengeEvmCall {
  return {
    address: args.address,
    abi: KarPassportAbi,
    functionName: "conclude",
    args: [BigInt(args.tokenId)],
    chainId: wagmiChainId(args.chainId),
  };
}

/**
 * Assemble the six ConcludeChallenge metas in processor order
 * (`entrypoint.rs` conclude_challenge): config, asset, state, challenge,
 * bond_recipient, payer.
 *
 * Roles from processor facts: config/asset READONLY; state WRITABLE
 * (save_state); challenge WRITABLE (debit + save); bond_recipient WRITABLE
 * (credit); payer READONLY_SIGNER (is_signer only — no create_pda). Fee-payer
 * writability at the message layer is not this meta's claim.
 */
export function assembleConcludeChallengeAccounts(args: {
  config: string;
  asset: string;
  state: string;
  challenge: string;
  bondRecipient: string;
  payer: string;
}): SvmWriteAccountMeta[] {
  return [
    { address: args.config, role: AccountRole.READONLY },
    { address: args.asset, role: AccountRole.READONLY },
    { address: args.state, role: AccountRole.WRITABLE },
    { address: args.challenge, role: AccountRole.WRITABLE },
    { address: args.bondRecipient, role: AccountRole.WRITABLE },
    { address: args.payer, role: AccountRole.READONLY_SIGNER },
  ];
}

export async function planConcludeChallenge(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  registry?: CommercialRegistry;
  /** Test inject — product path uses live getAccountInfo. */
  fetchAccountData?: FetchSvmAccountDataFn;
}): Promise<PlanConcludeChallengeResult> {
  const avail = txWriteAvailability(
    input.account,
    input.chainId,
    input.registry,
  );
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
      const call = buildEvmConcludeChallengeCall({
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

  return planSvmConcludeChallenge({
    stack,
    account: input.account,
    tokenId: input.tokenId,
    fetchAccountData: input.fetchAccountData ?? fetchProductSvmAccountData,
  });
}

/**
 * Resolve bond_recipient — config forfeit only (never challenge/challenger).
 * Absence / decode failure → named refusal (never invent).
 */
async function resolveForfeitRecipient(args: {
  configAddress: string;
  fetchAccountData: FetchSvmAccountDataFn;
}): Promise<
  | { ok: true; recipient: string }
  | { ok: false; cause: ConcludeChallengeCause; detail: string }
> {
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

async function planSvmConcludeChallenge(args: {
  stack: SvmCommercialActiveStack;
  account: ActiveAccount;
  tokenId: string;
  fetchAccountData: FetchSvmAccountDataFn;
}): Promise<PlanConcludeChallengeResult> {
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
    variant: "ConcludeChallenge",
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

  const recipient = await resolveForfeitRecipient({
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

  const accounts = assembleConcludeChallengeAccounts({
    config: configPda.address,
    asset: assetPda.address,
    state: statePda.address,
    challenge: challengePda.address,
    bondRecipient: recipient.recipient,
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
    },
  };
}

export async function executeConcludeChallenge(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  writeEvmContract: WriteEvmContractFn;
  registry?: CommercialRegistry;
  svmPort?: SvmSignAndSendPort;
  fetchBlockhash?: Parameters<typeof sendSvmInstruction>[0]["fetchBlockhash"];
  fetchAccountData?: FetchSvmAccountDataFn;
}): Promise<string> {
  const planned = await planConcludeChallenge({
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
        : `concludeChallenge refused: ${planned.cause}`,
    );
  }

  if (planned.vm === "evm") {
    return input.writeEvmContract(planned.call);
  }

  if (input.svmPort == null) {
    throw new Error("concludeChallenge refused: no_connected_account");
  }

  const stack = commercialActive(input.chainId, input.registry);
  if (stack == null || stack.vm !== "svm") {
    throw new Error("concludeChallenge refused: unresolved_namespace");
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
    throw new Error(`concludeChallenge refused: ${sent.cause}:${sent.detail}`);
  }
  return sent.signature;
}
