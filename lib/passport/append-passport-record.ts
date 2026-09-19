/**
 * Sole dual-VM owner for passport AppendRecord (U6.3).
 *
 * Panels call through {@link executeAppendPassportRecord} (via
 * `useAppendPassportRecord`) and pass the result through `runTx`.
 * Action-surface gates (DISPUTED / listing / owner) stay in
 * `derivePassportActionSurface` — this owner never re-decides them.
 *
 * SVM: every assembly performs a fresh keyed-read of PassportState and derives
 * the record PDA at the decoded `recordCount`. No cached index, no local
 * increment, no free-slot search. Clarification is the same builder with
 * `recordType: "dispute-clarification"`.
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

/** EVM call shape — behavioural pin: appendRecord + four args. */
export type AppendPassportRecordEvmCall = {
  address: `0x${string}`;
  abi: typeof KarPassportAbi;
  functionName: "appendRecord";
  args: [bigint, string, string, string];
  chainId: number;
};

export type AppendPassportRecordSvmPlan = {
  programId: string;
  data: Uint8Array;
  accounts: readonly SvmWriteAccountMeta[];
  feePayer: string;
  /** Decoded index used for the record PDA — fresh every assembly. */
  recordCount: number;
};

export type AppendPassportRecordCause =
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

export type PlanAppendPassportRecordResult =
  | { ok: true; vm: "evm"; call: AppendPassportRecordEvmCall }
  | { ok: true; vm: "svm"; plan: AppendPassportRecordSvmPlan }
  | {
      ok: false;
      cause: AppendPassportRecordCause;
      detail: string;
      wanted?: WalletFamilyWanted;
    };

export type WriteEvmContractFn = (
  args: AppendPassportRecordEvmCall,
) => Promise<`0x${string}`>;

/** Injectable account-data fetch for freshness proofs (tests). */
export type FetchSvmAccountDataFn = (
  account: string,
) => Promise<FetchSvmAccountDataResult>;

/**
 * Build the EVM write args. Sole construction site for the behavioural pin.
 * Do not invent a second functionName here.
 */
export function buildEvmAppendPassportRecordCall(args: {
  address: `0x${string}`;
  tokenId: string;
  recordType: string;
  description: string;
  evidenceCid: string;
  chainId: number;
}): AppendPassportRecordEvmCall {
  return {
    address: args.address,
    abi: KarPassportAbi,
    functionName: "appendRecord",
    args: [
      BigInt(args.tokenId),
      args.recordType,
      args.description,
      args.evidenceCid,
    ],
    chainId: wagmiChainId(args.chainId),
  };
}

/**
 * Assemble the seven AppendRecord metas in processor order
 * (`entrypoint.rs` append_record): config, asset, state, record, author,
 * payer, system.
 */
export function assembleAppendPassportRecordAccounts(args: {
  config: string;
  asset: string;
  state: string;
  record: string;
  author: string;
  payer: string;
  system: string;
}): SvmWriteAccountMeta[] {
  return [
    { address: args.config, role: AccountRole.READONLY },
    { address: args.asset, role: AccountRole.READONLY },
    { address: args.state, role: AccountRole.WRITABLE },
    { address: args.record, role: AccountRole.WRITABLE },
    { address: args.author, role: AccountRole.READONLY_SIGNER },
    { address: args.payer, role: AccountRole.WRITABLE_SIGNER },
    { address: args.system, role: AccountRole.READONLY },
  ];
}

export async function planAppendPassportRecord(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  recordType: string;
  description: string;
  evidenceCid: string;
  registry?: CommercialRegistry;
  /** Test inject — product path uses live getAccountInfo. */
  fetchAccountData?: FetchSvmAccountDataFn;
}): Promise<PlanAppendPassportRecordResult> {
  const avail = txWriteAvailabilityForCapability(input.account, "append_passport_record", input.chainId, input.registry,);
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
      const call = buildEvmAppendPassportRecordCall({
        address,
        tokenId: input.tokenId,
        recordType: input.recordType,
        description: input.description,
        evidenceCid: input.evidenceCid,
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

  return planSvmAppendPassportRecord({
    stack,
    account: input.account,
    tokenId: input.tokenId,
    recordType: input.recordType,
    description: input.description,
    evidenceCid: input.evidenceCid,
    fetchAccountData: input.fetchAccountData ?? fetchProductSvmAccountData,
  });
}

async function planSvmAppendPassportRecord(args: {
  stack: SvmCommercialActiveStack;
  account: ActiveAccount;
  tokenId: string;
  recordType: string;
  description: string;
  evidenceCid: string;
  fetchAccountData: FetchSvmAccountDataFn;
}): Promise<PlanAppendPassportRecordResult> {
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
    variant: "AppendRecord",
    fields: {
      token_id: tokenBytes,
      record_type: args.recordType,
      description: args.description,
      evidence_cid: args.evidenceCid,
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
  const [configPda, assetPda, statePda] = await Promise.all([
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
  ]);

  for (const pda of [configPda, assetPda, statePda]) {
    if (!pda.ok) {
      return {
        ok: false,
        cause: "pda_failed",
        detail: `${pda.cause}:${pda.detail}`,
      };
    }
  }
  if (!configPda.ok || !assetPda.ok || !statePda.ok) {
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

  const author = args.account.address;
  const accounts = assembleAppendPassportRecordAccounts({
    config: configPda.address,
    asset: assetPda.address,
    state: statePda.address,
    record: recordPda.address,
    author,
    payer: author,
    system: systemProgramId(),
  });

  return {
    ok: true,
    vm: "svm",
    plan: {
      programId,
      data: encoded.data,
      accounts,
      feePayer: author,
      recordCount,
    },
  };
}

export async function executeAppendPassportRecord(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  recordType: string;
  description: string;
  evidenceCid: string;
  writeEvmContract: WriteEvmContractFn;
  registry?: CommercialRegistry;
  svmPort?: SvmSignAndSendPort;
  fetchBlockhash?: Parameters<typeof sendSvmInstruction>[0]["fetchBlockhash"];
  fetchAccountData?: FetchSvmAccountDataFn;
}): Promise<string> {
  const planned = await planAppendPassportRecord({
    account: input.account,
    chainId: input.chainId,
    tokenId: input.tokenId,
    recordType: input.recordType,
    description: input.description,
    evidenceCid: input.evidenceCid,
    registry: input.registry,
    fetchAccountData: input.fetchAccountData,
  });
  if (!planned.ok) {
    throw new Error(
      planned.detail.length > 0
        ? planned.detail
        : `appendPassportRecord refused: ${planned.cause}`,
    );
  }

  if (planned.vm === "evm") {
    return input.writeEvmContract(planned.call);
  }

  if (input.svmPort == null) {
    throw new Error("appendPassportRecord refused: no_connected_account");
  }

  const stack = commercialActive(input.chainId, input.registry);
  if (stack == null || stack.vm !== "svm") {
    throw new Error("appendPassportRecord refused: unresolved_namespace");
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
      `appendPassportRecord refused: ${sent.cause}:${sent.detail}`,
    );
  }
  return sent.signature;
}
