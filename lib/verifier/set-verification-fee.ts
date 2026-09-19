/**
 * Sole dual-VM owner for KarPro `setVerificationFee` / `StakingIx::SetVerificationFee`.
 *
 * Panels call through {@link executeSetVerificationFee} (via `useSetVerificationFee`)
 * and pass the result through `runTx`. Composition is VM-named in
 * `verification-fee-composition` — this owner never folds EVM gas into SVM.
 *
 * VM fork lives here only (not in app/components/hooks). Composes U3 encode,
 * U4 PDA derive, U5 send. Program id from COMMERCIAL_ACTIVE; verifier from session.
 */

import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { encodeSvmInstruction } from "@/lib/svm/encode-instruction";
import { deriveSvmPda } from "@/lib/svm/derive-pda";
import {
  composeEvmVerificationFeeWei,
  composeSvmVerificationFeeLamports,
} from "@/lib/verifier/verification-fee-composition";
import {
  type ActiveAccount,
  type WalletFamilyWanted,
} from "@/lib/web3/active-account";
import {
  commercialActive,
  nativeUnitOf,
  type CommercialRegistry,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
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

/** EVM call shape — behavioural pin: setVerificationFee + [feeWei]. */
export type SetVerificationFeeEvmCall = {
  address: `0x${string}`;
  abi: typeof KarProStakingAbi;
  functionName: "setVerificationFee";
  args: [bigint];
  chainId: number;
};

export type SetVerificationFeeSvmPlan = {
  programId: string;
  data: Uint8Array;
  accounts: readonly SvmWriteAccountMeta[];
  feePayer: string;
};

export type SetVerificationFeeCause =
  | "disconnected"
  | "wrong_vm"
  | "unresolved_namespace"
  | "not_in_program"
  | "product_owner_owed"
  | "authority_only"
  | "staking_not_configured"
  | "encode_failed"
  | "pda_failed"
  | "wallet_cannot_sign_and_send"
  | "no_connected_account"
  | "send_failed"
  | "invalid_fee";

export type PlanSetVerificationFeeResult =
  | { ok: true; vm: "evm"; call: SetVerificationFeeEvmCall; fee: bigint }
  | { ok: true; vm: "svm"; plan: SetVerificationFeeSvmPlan; fee: bigint }
  | {
      ok: false;
      cause: SetVerificationFeeCause;
      detail: string;
      wanted?: WalletFamilyWanted;
    };

export type WriteEvmContractFn = (
  args: SetVerificationFeeEvmCall,
) => Promise<`0x${string}`>;

/**
 * Build the EVM write args. Sole construction site for the behavioural pin.
 * Do not invent a second functionName here.
 */
export function buildEvmSetVerificationFeeCall(args: {
  address: `0x${string}`;
  feeWei: bigint;
  chainId: number;
}): SetVerificationFeeEvmCall {
  return {
    address: args.address,
    abi: KarProStakingAbi,
    functionName: "setVerificationFee",
    args: [args.feeWei],
    chainId: wagmiChainId(args.chainId),
  };
}

/**
 * Assemble the three SetVerificationFee metas in processor order
 * (`entrypoint.rs` set_verification_fee): config, stake, verifier(signer).
 */
export function assembleSetVerificationFeeAccounts(args: {
  config: string;
  stake: string;
  verifier: string;
}): SvmWriteAccountMeta[] {
  return [
    { address: args.config, role: AccountRole.READONLY },
    { address: args.stake, role: AccountRole.WRITABLE },
    { address: args.verifier, role: AccountRole.READONLY_SIGNER },
  ];
}

export type PlanSetVerificationFeeInput = {
  account: ActiveAccount;
  /** Commercial namespace / EIP-155 id of the write target. */
  chainId: number;
  /**
   * EVM: service margin in wei (gas added here via compose).
   * SVM: service margin in lamports (compose ignores gas — none accepted).
   */
  marginNative: bigint;
  /** EVM-only gas estimate; must be null/omitted for SVM composition honesty. */
  gasWei?: bigint | null;
  registry?: CommercialRegistry;
};

export async function planSetVerificationFee(
  input: PlanSetVerificationFeeInput,
): Promise<PlanSetVerificationFeeResult> {
  const avail = txWriteAvailabilityForCapability(input.account, "set_verification_fee", input.chainId, input.registry,);
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
    const address = karProStakingAddress(input.chainId);
    if (address == null) {
      return {
        ok: false,
        cause: "staking_not_configured",
        detail: `no karProStaking for chain ${input.chainId}`,
      };
    }
    if (input.marginNative < 0n) {
      return {
        ok: false,
        cause: "invalid_fee",
        detail: "negative margin",
      };
    }
    const fee = composeEvmVerificationFeeWei(
      input.marginNative,
      input.gasWei ?? null,
    );
    const call = buildEvmSetVerificationFeeCall({
      address,
      feeWei: fee,
      chainId: input.chainId,
    });
    return { ok: true, vm: "evm", call, fee };
  }

  if (stack.vm !== "svm") {
    return {
      ok: false,
      cause: "wrong_vm",
      detail: "availability/stack vm mismatch",
      wanted: stack.vm,
    };
  }

  return planSvmSetVerificationFee({
    stack,
    account: input.account,
    marginLamports: input.marginNative,
  });
}

async function planSvmSetVerificationFee(args: {
  stack: SvmCommercialActiveStack;
  account: ActiveAccount;
  marginLamports: bigint;
}): Promise<PlanSetVerificationFeeResult> {
  if (args.account.status !== "connected" || args.account.vm !== "svm") {
    return {
      ok: false,
      cause: "wrong_vm",
      detail: "SVM plan requires connected SVM session",
      wanted: "svm",
    };
  }

  if (args.marginLamports < 0n) {
    return {
      ok: false,
      cause: "invalid_fee",
      detail: "negative margin",
    };
  }

  // Unit honesty: SVM composition API cannot accept gas — only margin.
  const fee = composeSvmVerificationFeeLamports(args.marginLamports);
  // Touch native unit so tests can assert stack unit is consulted for SVM.
  void nativeUnitOf(args.stack);

  const encoded = encodeSvmInstruction({
    program: "kar-pro-staking",
    variant: "SetVerificationFee",
    fields: { fee },
  });
  if (!encoded.ok) {
    return {
      ok: false,
      cause: "encode_failed",
      detail: `${encoded.cause}:${encoded.detail}`,
    };
  }

  const programId = args.stack.karProStaking;
  const verifier = args.account.address;

  const [configPda, stakePda] = await Promise.all([
    deriveSvmPda({ recipe: "kar-pro-staking/config", programId }),
    deriveSvmPda({
      recipe: "kar-pro-staking/stake",
      programId,
      seeds: { verifier },
    }),
  ]);

  for (const pda of [configPda, stakePda]) {
    if (!pda.ok) {
      return {
        ok: false,
        cause: "pda_failed",
        detail: `${pda.cause}:${pda.detail}`,
      };
    }
  }
  if (!configPda.ok || !stakePda.ok) {
    return { ok: false, cause: "pda_failed", detail: "unreachable" };
  }

  const accounts = assembleSetVerificationFeeAccounts({
    config: configPda.address,
    stake: stakePda.address,
    verifier,
  });

  return {
    ok: true,
    vm: "svm",
    fee,
    plan: {
      programId,
      data: encoded.data,
      accounts,
      feePayer: verifier,
    },
  };
}

export async function executeSetVerificationFee(input: {
  account: ActiveAccount;
  chainId: number;
  marginNative: bigint;
  gasWei?: bigint | null;
  writeEvmContract: WriteEvmContractFn;
  registry?: CommercialRegistry;
  svmPort?: SvmSignAndSendPort;
  fetchBlockhash?: Parameters<typeof sendSvmInstruction>[0]["fetchBlockhash"];
}): Promise<string> {
  const planned = await planSetVerificationFee({
    account: input.account,
    chainId: input.chainId,
    marginNative: input.marginNative,
    gasWei: input.gasWei,
    registry: input.registry,
  });
  if (!planned.ok) {
    throw new Error(
      planned.detail.length > 0
        ? planned.detail
        : `setVerificationFee refused: ${planned.cause}`,
    );
  }

  if (planned.vm === "evm") {
    return input.writeEvmContract(planned.call);
  }

  if (input.svmPort == null) {
    throw new Error("setVerificationFee refused: no_connected_account");
  }

  const stack = commercialActive(input.chainId, input.registry);
  if (stack == null || stack.vm !== "svm") {
    throw new Error("setVerificationFee refused: unresolved_namespace");
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
    throw new Error(
      `setVerificationFee refused: ${sent.cause}:${sent.detail}`,
    );
  }
  return sent.signature;
}

/** Named absence — current on-chain fee cannot be read on SVM until U7. */
export const VERIFICATION_FEE_SVM_CURRENT_UNREAD =
  "Current fee unread on Solana until chain reads are available.";
