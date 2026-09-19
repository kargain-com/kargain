/**
 * Sole dual-VM owner for the "verify passport" write.
 *
 * Panels call through {@link executeVerifyPassport} (via `useVerifyPassport`)
 * and pass the result through `runTx`. Verifier admission and self-verify /
 * status gates are owned by the passport action-surface (+ active-verifier
 * fact) — this owner never re-decides them.
 *
 * VM fork lives here only (not in app/components/hooks). SVM assembly is
 * derive-only: five metas, no PassportState freshness read, no stake-data
 * decode (program proves activity on the answer account). Sibling of
 * AppendAttestation — no shared assembler.
 */

import { KarPassportAbi } from "@/lib/contracts/abis.generated";
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

/** EVM call shape — behavioural pin: verifyPassport + [BigInt(tokenId)]. */
export type VerifyPassportEvmCall = {
  address: `0x${string}`;
  abi: typeof KarPassportAbi;
  functionName: "verifyPassport";
  args: [bigint];
  chainId: number;
};

export type VerifyPassportSvmPlan = {
  programId: string;
  data: Uint8Array;
  accounts: readonly SvmWriteAccountMeta[];
  feePayer: string;
};

export type VerifyPassportCause =
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
  | "wallet_cannot_sign_and_send"
  | "no_connected_account"
  | "send_failed";

export type PlanVerifyPassportResult =
  | { ok: true; vm: "evm"; call: VerifyPassportEvmCall }
  | { ok: true; vm: "svm"; plan: VerifyPassportSvmPlan }
  | {
      ok: false;
      cause: VerifyPassportCause;
      detail: string;
      wanted?: WalletFamilyWanted;
    };

export type WriteEvmContractFn = (
  args: VerifyPassportEvmCall,
) => Promise<`0x${string}`>;

/**
 * Build the EVM write args. Sole construction site for the behavioural pin.
 * Do not invent a second functionName or a second argument here.
 */
export function buildEvmVerifyPassportCall(args: {
  address: `0x${string}`;
  tokenId: string;
  chainId: number;
}): VerifyPassportEvmCall {
  return {
    address: args.address,
    abi: KarPassportAbi,
    functionName: "verifyPassport",
    args: [BigInt(args.tokenId)],
    chainId: wagmiChainId(args.chainId),
  };
}

/**
 * Assemble the five VerifyPassport metas in processor order
 * (`entrypoint.rs` verify_passport): config, asset, state, stake, verifier.
 *
 * Roles: config/asset/stake READONLY; state WRITABLE; verifier READONLY_SIGNER.
 * No record / payer / system — nothing is created.
 */
export function assembleVerifyPassportAccounts(args: {
  config: string;
  asset: string;
  state: string;
  stake: string;
  verifier: string;
}): SvmWriteAccountMeta[] {
  return [
    { address: args.config, role: AccountRole.READONLY },
    { address: args.asset, role: AccountRole.READONLY },
    { address: args.state, role: AccountRole.WRITABLE },
    { address: args.stake, role: AccountRole.READONLY },
    { address: args.verifier, role: AccountRole.READONLY_SIGNER },
  ];
}

export async function planVerifyPassport(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  registry?: CommercialRegistry;
}): Promise<PlanVerifyPassportResult> {
  const avail = txWriteAvailabilityForCapability(input.account, "verify_passport", input.chainId, input.registry,);
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
      const call = buildEvmVerifyPassportCall({
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

  return planSvmVerifyPassport({
    stack,
    account: input.account,
    tokenId: input.tokenId,
  });
}

/**
 * Derive-only SVM assembly. No PassportState fetch and no stake-data decode —
 * the program reads stake bytes as the answer-account proof.
 */
async function planSvmVerifyPassport(args: {
  stack: SvmCommercialActiveStack;
  account: ActiveAccount;
  tokenId: string;
}): Promise<PlanVerifyPassportResult> {
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
    variant: "VerifyPassport",
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
  const stakingProgramId = args.stack.karProStaking;
  const verifier = args.account.address;

  const [configPda, assetPda, statePda, stakePda] = await Promise.all([
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
      recipe: "kar-pro-staking/stake",
      programId: stakingProgramId,
      seeds: { verifier },
    }),
  ]);

  for (const pda of [configPda, assetPda, statePda, stakePda]) {
    if (!pda.ok) {
      return {
        ok: false,
        cause: "pda_failed",
        detail: `${pda.cause}:${pda.detail}`,
      };
    }
  }
  if (!configPda.ok || !assetPda.ok || !statePda.ok || !stakePda.ok) {
    return { ok: false, cause: "pda_failed", detail: "unreachable" };
  }

  const accounts = assembleVerifyPassportAccounts({
    config: configPda.address,
    asset: assetPda.address,
    state: statePda.address,
    stake: stakePda.address,
    verifier,
  });

  return {
    ok: true,
    vm: "svm",
    plan: {
      programId,
      data: encoded.data,
      accounts,
      feePayer: verifier,
    },
  };
}

export async function executeVerifyPassport(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  writeEvmContract: WriteEvmContractFn;
  registry?: CommercialRegistry;
  /** Bound Wallet Standard port — hook builds via createSvmSignAndSendPort. */
  svmPort?: SvmSignAndSendPort;
  fetchBlockhash?: Parameters<typeof sendSvmInstruction>[0]["fetchBlockhash"];
}): Promise<string> {
  const planned = await planVerifyPassport({
    account: input.account,
    chainId: input.chainId,
    tokenId: input.tokenId,
    registry: input.registry,
  });
  if (!planned.ok) {
    throw new Error(
      planned.detail.length > 0
        ? planned.detail
        : `verifyPassport refused: ${planned.cause}`,
    );
  }

  if (planned.vm === "evm") {
    return input.writeEvmContract(planned.call);
  }

  if (input.svmPort == null) {
    throw new Error("verifyPassport refused: no_connected_account");
  }

  const stack = commercialActive(input.chainId, input.registry);
  if (stack == null || stack.vm !== "svm") {
    throw new Error("verifyPassport refused: unresolved_namespace");
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
    throw new Error(`verifyPassport refused: ${sent.cause}:${sent.detail}`);
  }
  return sent.signature;
}
