/**
 * Sole dual-VM owner for the "set passport URI" write.
 *
 * Panels call through {@link executeSetPassportUri} (via `useSetPassportUri`)
 * and pass the result through `runTx`. Edit permission is owned by the
 * passport action-surface module — this owner never re-decides it.
 *
 * VM fork lives here only (not in app/components/hooks). Composes U3 encode,
 * U4 PDA derive, U5 send, foreign-programs reader, and tokenIdToBytes32.
 */

import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { encodeSvmInstruction } from "@/lib/svm/encode-instruction";
import { deriveSvmPda } from "@/lib/svm/derive-pda";
import { tokenIdToBytes32 } from "@/lib/svm/event-payload-decode";
import {
  mplCoreProgramId,
  systemProgramId,
} from "@/lib/svm/foreign-programs";
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
  txWriteAvailability,
  txWriteRefusalMessage,
} from "@/lib/web3/tx-write-availability";
/** EVM call shape — behavioural pin: setPassportURI + [BigInt(tokenId), uri]. */
export type SetPassportUriEvmCall = {
  address: `0x${string}`;
  abi: typeof KarPassportAbi;
  functionName: "setPassportURI";
  args: [bigint, string];
  chainId: number;
};

export type SetPassportUriSvmPlan = {
  programId: string;
  data: Uint8Array;
  accounts: readonly SvmWriteAccountMeta[];
  feePayer: string;
};

export type SetPassportUriCause =
  | "disconnected"
  | "wrong_vm"
  | "unresolved_namespace"
  | "passport_not_configured"
  | "invalid_token_id"
  | "encode_failed"
  | "pda_failed"
  | "wallet_cannot_sign_and_send"
  | "no_connected_account"
  | "send_failed";

export type PlanSetPassportUriResult =
  | { ok: true; vm: "evm"; call: SetPassportUriEvmCall }
  | { ok: true; vm: "svm"; plan: SetPassportUriSvmPlan }
  | {
      ok: false;
      cause: SetPassportUriCause;
      detail: string;
      wanted?: WalletFamilyWanted;
    };

export type WriteEvmContractFn = (
  args: SetPassportUriEvmCall,
) => Promise<`0x${string}`>;

/**
 * Build the EVM write args. Sole construction site for the behavioural pin.
 * Do not invent a second functionName here.
 */
export function buildEvmSetPassportUriCall(args: {
  address: `0x${string}`;
  tokenId: string;
  uri: string;
  chainId: number;
}): SetPassportUriEvmCall {
  return {
    address: args.address,
    abi: KarPassportAbi,
    functionName: "setPassportURI",
    args: [BigInt(args.tokenId), args.uri],
    chainId: wagmiChainId(args.chainId),
  };
}

/**
 * Assemble the seven SetPassportUri metas in processor order
 * (`entrypoint.rs` set_passport_uri): config, asset, state, owner, payer, core, system.
 */
export function assembleSetPassportUriAccounts(args: {
  config: string;
  asset: string;
  state: string;
  owner: string;
  payer: string;
  core: string;
  system: string;
}): SvmWriteAccountMeta[] {
  return [
    { address: args.config, role: AccountRole.READONLY },
    { address: args.asset, role: AccountRole.WRITABLE },
    { address: args.state, role: AccountRole.WRITABLE },
    { address: args.owner, role: AccountRole.READONLY_SIGNER },
    { address: args.payer, role: AccountRole.WRITABLE_SIGNER },
    { address: args.core, role: AccountRole.READONLY },
    { address: args.system, role: AccountRole.READONLY },
  ];
}

export async function planSetPassportUri(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  uri: string;
  registry?: CommercialRegistry;
}): Promise<PlanSetPassportUriResult> {
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
      const call = buildEvmSetPassportUriCall({
        address,
        tokenId: input.tokenId,
        uri: input.uri,
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

  return planSvmSetPassportUri({
    stack,
    account: input.account,
    tokenId: input.tokenId,
    uri: input.uri,
  });
}

async function planSvmSetPassportUri(args: {
  stack: SvmCommercialActiveStack;
  account: ActiveAccount;
  tokenId: string;
  uri: string;
}): Promise<PlanSetPassportUriResult> {
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
    variant: "SetPassportUri",
    fields: {
      token_id: tokenBytes,
      uri: args.uri,
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

  const owner = args.account.address;
  const accounts = assembleSetPassportUriAccounts({
    config: configPda.address,
    asset: assetPda.address,
    state: statePda.address,
    owner,
    payer: owner,
    core: mplCoreProgramId(),
    system: systemProgramId(),
  });

  return {
    ok: true,
    vm: "svm",
    plan: {
      programId,
      data: encoded.data,
      accounts,
      feePayer: owner,
    },
  };
}

export async function executeSetPassportUri(input: {
  account: ActiveAccount;
  chainId: number;
  tokenId: string;
  uri: string;
  writeEvmContract: WriteEvmContractFn;
  registry?: CommercialRegistry;
  /** Bound Wallet Standard port — hook builds via createSvmSignAndSendPort. */
  svmPort?: SvmSignAndSendPort;
  fetchBlockhash?: Parameters<typeof sendSvmInstruction>[0]["fetchBlockhash"];
}): Promise<string> {
  const planned = await planSetPassportUri({
    account: input.account,
    chainId: input.chainId,
    tokenId: input.tokenId,
    uri: input.uri,
    registry: input.registry,
  });
  if (!planned.ok) {
    throw new Error(
      planned.detail.length > 0
        ? planned.detail
        : `setPassportUri refused: ${planned.cause}`,
    );
  }

  if (planned.vm === "evm") {
    return input.writeEvmContract(planned.call);
  }

  if (input.svmPort == null) {
    throw new Error("setPassportUri refused: no_connected_account");
  }

  const stack = commercialActive(input.chainId, input.registry);
  if (stack == null || stack.vm !== "svm") {
    throw new Error("setPassportUri refused: unresolved_namespace");
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
    throw new Error(`setPassportUri refused: ${sent.cause}:${sent.detail}`);
  }
  return sent.signature;
}
