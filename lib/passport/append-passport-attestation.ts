/**
 * Sole dual-VM owner for passport AppendAttestation (U6.5).
 *
 * Sibling of AppendRecord and ReportDiscrepancy — not an extension. The
 * programs share `append_record_checked`; the products do not share an
 * assembler. Action-surface (active verifier + not owner) decides who sees
 * the control. This owner never re-decides those gates.
 *
 * EVM: appendAttestation with three args (type fixed inside the contract).
 * SVM: fresh PassportState keyed-read → record PDA at recordCount; stake PDA
 * derived from attester (data not read to assemble — program proves activity).
 * Eight metas in processor order.
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
  txWriteAvailability,
  txWriteRefusalMessage,
} from "@/lib/web3/tx-write-availability";

/** EVM call shape — behavioural pin: appendAttestation + three args. */
export type AppendPassportAttestationEvmCall = {
  address: `0x${string}`;
  abi: typeof KarPassportAbi;
  functionName: "appendAttestation";
  args: [bigint, string, string];
  chainId: number;
};

export type AppendPassportAttestationSvmPlan = {
  programId: string;
  data: Uint8Array;
  accounts: readonly SvmWriteAccountMeta[];
  feePayer: string;
  /** Decoded index used for the record PDA — fresh every assembly. */
  recordCount: number;
};

export type AppendPassportAttestationCause =
  | "disconnected"
  | "wrong_vm"
  | "unresolved_namespace"
  | "passport_not_configured"
  | "invalid_token_id"
  | "encode_failed"
  | "pda_failed"
  | "state_unavailable"
  | "state_decode_failed"
  | "wallet_cannot_sign_and_send"
  | "no_connected_account"
  | "send_failed";

export type PlanAppendPassportAttestationResult =
  | { ok: true; vm: "evm"; call: AppendPassportAttestationEvmCall }
  | { ok: true; vm: "svm"; plan: AppendPassportAttestationSvmPlan }
  | {
      ok: false;
      cause: AppendPassportAttestationCause;
      detail: string;
      wanted?: WalletFamilyWanted;
    };

export type WriteEvmContractFn = (
  args: AppendPassportAttestationEvmCall,
) => Promise<`0x${string}`>;

/** Injectable account-data fetch for freshness proofs (tests). */
export type FetchSvmAccountDataFn = (
  account: string,
) => Promise<FetchSvmAccountDataResult>;

/**
 * Build the EVM write args. Sole construction site for the behavioural pin.
 * Three arguments — do not invent a fourth (appendRecord shape).
 */
export function buildEvmAppendPassportAttestationCall(args: {
  address: `0x${string}`;
  tokenId: string;
  description: string;
  evidenceCid: string;
  chainId: number;
}): AppendPassportAttestationEvmCall {
  return {
    address: args.address,
    abi: KarPassportAbi,
    functionName: "appendAttestation",
    args: [BigInt(args.tokenId), args.description, args.evidenceCid],
    chainId: wagmiChainId(args.chainId),
  };
}

/**
 * Assemble the eight AppendAttestation metas in processor order
 * (`entrypoint.rs` append_attestation :835–842):
 * config, asset, state, record, attester, stake, payer, system.
 *
 * Roles: config READONLY (load_config :847); asset READONLY
 * (gate_and_read_owner, discarded); state+record WRITABLE; attester
 * READONLY_SIGNER; stake READONLY (derived address, data not read here);
 * payer WRITABLE_SIGNER; system READONLY.
 */
export function assembleAppendPassportAttestationAccounts(args: {
  config: string;
  asset: string;
  state: string;
  record: string;
  attester: string;
  stake: string;
  payer: string;
  system: string;
}): SvmWriteAccountMeta[] {
  return [
    { address: args.config, role: AccountRole.READONLY },
    { address: args.asset, role: AccountRole.READONLY },
    { address: args.state, role: AccountRole.WRITABLE },
    { address: args.record, role: AccountRole.WRITABLE },
    { address: args.attester, role: AccountRole.READONLY_SIGNER },
    { address: args.stake, role: AccountRole.READONLY },
    { address: args.payer, role: AccountRole.WRITABLE_SIGNER },
    { address: args.system, role: AccountRole.READONLY },
  ];
}

export async function planAppendPassportAttestation(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  description: string;
  evidenceCid: string;
  registry?: CommercialRegistry;
  /** Test inject — product path uses live getAccountInfo. */
  fetchAccountData?: FetchSvmAccountDataFn;
}): Promise<PlanAppendPassportAttestationResult> {
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
      const call = buildEvmAppendPassportAttestationCall({
        address,
        tokenId: input.tokenId,
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

  return planSvmAppendPassportAttestation({
    stack,
    account: input.account,
    tokenId: input.tokenId,
    description: input.description,
    evidenceCid: input.evidenceCid,
    fetchAccountData: input.fetchAccountData ?? fetchProductSvmAccountData,
  });
}

async function planSvmAppendPassportAttestation(args: {
  stack: SvmCommercialActiveStack;
  account: ActiveAccount;
  tokenId: string;
  description: string;
  evidenceCid: string;
  fetchAccountData: FetchSvmAccountDataFn;
}): Promise<PlanAppendPassportAttestationResult> {
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
    variant: "AppendAttestation",
    fields: {
      token_id: tokenBytes,
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
  const stakingProgramId = args.stack.karProStaking;
  const attester = args.account.address;

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
      seeds: { verifier: attester },
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

  // Fresh read every assembly — record index lives only in state.
  // Stake address is derived above; stake *data* is not read to assemble.
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

  const accounts = assembleAppendPassportAttestationAccounts({
    config: configPda.address,
    asset: assetPda.address,
    state: statePda.address,
    record: recordPda.address,
    attester,
    stake: stakePda.address,
    payer: attester,
    system: systemProgramId(),
  });

  return {
    ok: true,
    vm: "svm",
    plan: {
      programId,
      data: encoded.data,
      accounts,
      feePayer: attester,
      recordCount,
    },
  };
}

export async function executeAppendPassportAttestation(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  description: string;
  evidenceCid: string;
  writeEvmContract: WriteEvmContractFn;
  registry?: CommercialRegistry;
  svmPort?: SvmSignAndSendPort;
  fetchBlockhash?: Parameters<typeof sendSvmInstruction>[0]["fetchBlockhash"];
  fetchAccountData?: FetchSvmAccountDataFn;
}): Promise<string> {
  const planned = await planAppendPassportAttestation({
    account: input.account,
    chainId: input.chainId,
    tokenId: input.tokenId,
    description: input.description,
    evidenceCid: input.evidenceCid,
    registry: input.registry,
    fetchAccountData: input.fetchAccountData,
  });
  if (!planned.ok) {
    throw new Error(
      planned.detail.length > 0
        ? planned.detail
        : `appendPassportAttestation refused: ${planned.cause}`,
    );
  }

  if (planned.vm === "evm") {
    return input.writeEvmContract(planned.call);
  }

  if (input.svmPort == null) {
    throw new Error("appendPassportAttestation refused: no_connected_account");
  }

  const stack = commercialActive(input.chainId, input.registry);
  if (stack == null || stack.vm !== "svm") {
    throw new Error("appendPassportAttestation refused: unresolved_namespace");
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
      `appendPassportAttestation refused: ${sent.cause}:${sent.detail}`,
    );
  }
  return sent.signature;
}
