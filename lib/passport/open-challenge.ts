/**
 * Sole dual-VM owner for the verification challenge `open` write.
 *
 * Panels call through {@link executeOpenChallenge} (via `useOpenChallenge`)
 * and pass the result through `runTx`. Eligibility is owned by the passport
 * action-surface — this owner never re-decides who may open.
 *
 * VM fork lives here only (not in app/components/hooks). SVM assembly is
 * derive-only: seven metas, no PassportState freshness, no account-state
 * decode of any kind. Sibling of VerifyPassport / AppendRecord — no shared
 * assembler.
 *
 * Challenger and payer are the same connected wallet in two meta slots: one
 * wallet is both the bond source (`pay_native` from challenger) and the rent
 * payer for challenge PDA create — locked Q2, not a dual-signer bug.
 */

import { KarPassportAbi } from "@/lib/contracts/abis.generated";
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

/** EVM call shape — behavioural pin: open + [BigInt(tokenId)] + value. */
export type OpenChallengeEvmCall = {
  address: `0x${string}`;
  abi: typeof KarPassportAbi;
  functionName: "open";
  args: [bigint];
  value: bigint;
  chainId: number;
};

export type OpenChallengeSvmPlan = {
  programId: string;
  data: Uint8Array;
  accounts: readonly SvmWriteAccountMeta[];
  feePayer: string;
};

export type OpenChallengeCause =
  | "disconnected"
  | "wrong_vm"
  | "unresolved_namespace"
  | "not_in_program"
  | "product_owner_owed"
  | "authority_only"
  | "passport_not_configured"
  | "deposit_unknown"
  | "invalid_token_id"
  | "encode_failed"
  | "pda_failed"
  | "wallet_cannot_sign_and_send"
  | "no_connected_account"
  | "send_failed";

export type PlanOpenChallengeResult =
  | { ok: true; vm: "evm"; call: OpenChallengeEvmCall }
  | { ok: true; vm: "svm"; plan: OpenChallengeSvmPlan }
  | {
      ok: false;
      cause: OpenChallengeCause;
      detail: string;
      wanted?: WalletFamilyWanted;
    };

export type WriteEvmContractFn = (
  args: OpenChallengeEvmCall,
) => Promise<`0x${string}`>;

/**
 * Build the EVM write args. Sole construction site for the behavioural pin.
 * `value` must equal live `disputeDeposit` — missing value is refused at plan.
 */
export function buildEvmOpenChallengeCall(args: {
  address: `0x${string}`;
  tokenId: string;
  chainId: number;
  value: bigint;
}): OpenChallengeEvmCall {
  return {
    address: args.address,
    abi: KarPassportAbi,
    functionName: "open",
    args: [BigInt(args.tokenId)],
    value: args.value,
    chainId: wagmiChainId(args.chainId),
  };
}

/**
 * Assemble the seven OpenChallenge metas in processor order
 * (`entrypoint.rs` open_challenge): challenger, config, asset, state,
 * challenge, system, payer.
 *
 * Roles from processor facts: challenger WRITABLE_SIGNER (signer + pay_native
 * debit); config/asset READONLY; state WRITABLE (save_state); challenge
 * WRITABLE (create + credit + save_challenge); system READONLY; payer
 * WRITABLE_SIGNER (signer + create_pda rent). Challenger and payer are the
 * same pubkey (one connected wallet).
 */
export function assembleOpenChallengeAccounts(args: {
  challenger: string;
  config: string;
  asset: string;
  state: string;
  challenge: string;
  system: string;
  payer: string;
}): SvmWriteAccountMeta[] {
  return [
    { address: args.challenger, role: AccountRole.WRITABLE_SIGNER },
    { address: args.config, role: AccountRole.READONLY },
    { address: args.asset, role: AccountRole.READONLY },
    { address: args.state, role: AccountRole.WRITABLE },
    { address: args.challenge, role: AccountRole.WRITABLE },
    { address: args.system, role: AccountRole.READONLY },
    { address: args.payer, role: AccountRole.WRITABLE_SIGNER },
  ];
}

export async function planOpenChallenge(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  /** Required on EVM (msg.value). Ignored on SVM — program reads PassportConfig. */
  disputeDeposit?: bigint;
  registry?: CommercialRegistry;
}): Promise<PlanOpenChallengeResult> {
  const avail = txWriteAvailabilityForCapability(input.account, "open_challenge", input.chainId, input.registry,);
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
    if (input.disputeDeposit === undefined) {
      return {
        ok: false,
        cause: "deposit_unknown",
        detail: "EVM open requires disputeDeposit as msg.value",
      };
    }
    try {
      const call = buildEvmOpenChallengeCall({
        address,
        tokenId: input.tokenId,
        chainId: input.chainId,
        value: input.disputeDeposit,
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

  return planSvmOpenChallenge({
    stack,
    account: input.account,
    tokenId: input.tokenId,
  });
}

/**
 * Derive-only SVM assembly. No PassportState fetch and no account decode —
 * challenge PDA is keyed by token_id alone; program reads dispute_deposit.
 */
async function planSvmOpenChallenge(args: {
  stack: SvmCommercialActiveStack;
  account: ActiveAccount;
  tokenId: string;
}): Promise<PlanOpenChallengeResult> {
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
    variant: "OpenChallenge",
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
  // One wallet: bond source (challenger) and PDA rent payer — same pubkey twice.
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

  const accounts = assembleOpenChallengeAccounts({
    challenger: wallet,
    config: configPda.address,
    asset: assetPda.address,
    state: statePda.address,
    challenge: challengePda.address,
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
    },
  };
}

export async function executeOpenChallenge(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  disputeDeposit?: bigint;
  writeEvmContract: WriteEvmContractFn;
  registry?: CommercialRegistry;
  svmPort?: SvmSignAndSendPort;
  fetchBlockhash?: Parameters<typeof sendSvmInstruction>[0]["fetchBlockhash"];
}): Promise<string> {
  const planned = await planOpenChallenge({
    account: input.account,
    chainId: input.chainId,
    tokenId: input.tokenId,
    disputeDeposit: input.disputeDeposit,
    registry: input.registry,
  });
  if (!planned.ok) {
    throw new Error(
      planned.detail.length > 0
        ? planned.detail
        : `openChallenge refused: ${planned.cause}`,
    );
  }

  if (planned.vm === "evm") {
    return input.writeEvmContract(planned.call);
  }

  if (input.svmPort == null) {
    throw new Error("openChallenge refused: no_connected_account");
  }

  const stack = commercialActive(input.chainId, input.registry);
  if (stack == null || stack.vm !== "svm") {
    throw new Error("openChallenge refused: unresolved_namespace");
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
    throw new Error(`openChallenge refused: ${sent.cause}:${sent.detail}`);
  }
  return sent.signature;
}
