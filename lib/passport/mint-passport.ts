/**
 * Sole dual-VM owner for product Create mint.
 *
 * Wizard calls through {@link executeMintPassport} (via `useMintPassport`) and
 * passes a successful write reference through `runTx` for PassportMinted.
 * VM fork lives here only (not in app/components/hooks).
 *
 * SVM: fresh PassportConfig decode → asset/state for next_token_id; freeze +
 * gateway_config under registry bridgeGateway; registry config PDA must equal
 * chain bridge_gateway. Concurrent mint that advances next_token_id → landed
 * InvalidSeeds → {@link MintPassportCause} `mint_sequence_advanced`.
 */

import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { decodePassportConfig } from "@/lib/svm/decode-account-state";
import { encodeSvmInstruction } from "@/lib/svm/encode-instruction";
import { deriveSvmPda } from "@/lib/svm/derive-pda";
import type {
  DeriveSvmPdaResult,
  PdaSeedValue,
} from "@/lib/svm/derive-pda";
import { tokenIdFromBytes32 } from "@/lib/svm/event-payload-decode";
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
  unresolvedNamespaceCopy,
  type CommercialRegistry,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import {
  decodeSvmProgramError,
  REVERT_COPY,
} from "@/lib/marketplace/tx-error-message";
import {
  isWalletRejection,
  walletRejectionCopy,
} from "@/lib/web3/wallet-rejection";
import {
  fetchProductSvmAccountData,
  type FetchSvmAccountDataResult,
} from "@/lib/web3/svm-rpc";
import {
  AccountRole,
  sendSvmInstruction,
  type SendSvmInstructionCause,
  type SvmSignAndSendPort,
  type SvmWriteAccountMeta,
} from "@/lib/web3/svm-write-adapter";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import {
  txWriteAvailabilityForCapability,
  txWriteRefusalMessage,
} from "@/lib/web3/tx-write-availability";
import { surfaceSupportCauseCopy } from "@/lib/web3/surface-support";

/** EVM call shape — behavioural pin: mintPassport + [address, uri]. */
export type MintPassportEvmCall = {
  address: `0x${string}`;
  abi: typeof KarPassportAbi;
  functionName: "mintPassport";
  args: [`0x${string}`, string];
  chainId: number;
};

export type MintPassportSvmPlan = {
  programId: string;
  data: Uint8Array;
  accounts: readonly SvmWriteAccountMeta[];
  feePayer: string;
  /** Bytes planned for asset/state — fresh from config every assembly. */
  plannedNextTokenId: Uint8Array;
  /** Decimal string of plannedNextTokenId (reporting / sequence compare). */
  plannedTokenId: string;
};

export type MintPassportCause =
  | "disconnected"
  | "wrong_vm"
  | "unresolved_namespace"
  | "not_in_program"
  | "product_owner_owed"
  | "authority_only"
  | "passport_not_configured"
  | "config_unavailable"
  | "config_decode_failed"
  | "registry_bridge_gateway_mismatch"
  | "encode_failed"
  | "pda_failed"
  | "wallet_cannot_sign_and_send"
  | "no_connected_account"
  | "send_failed"
  | "mint_sequence_advanced"
  | "unmapped_program_error"
  | SendSvmInstructionCause;

export type PlanMintPassportResult =
  | { ok: true; vm: "evm"; call: MintPassportEvmCall }
  | { ok: true; vm: "svm"; plan: MintPassportSvmPlan }
  | {
      ok: false;
      cause: MintPassportCause;
      detail: string;
      wanted?: WalletFamilyWanted;
    };

export type ExecuteMintPassportResult =
  | { ok: true; signature: string; plannedTokenId?: string }
  | {
      ok: false;
      cause: MintPassportCause;
      detail: string;
      wanted?: WalletFamilyWanted;
    };

export type WriteEvmContractFn = (
  args: MintPassportEvmCall,
) => Promise<`0x${string}`>;

/** Injectable account-data fetch (tests / stand). */
export type FetchSvmAccountDataFn = (
  account: string,
) => Promise<FetchSvmAccountDataResult>;

export type SignatureStatusRow = {
  confirmationStatus?: string | null;
  err?: unknown;
  slot?: number | bigint | null;
} | null;

export type GetSignatureStatusesFn = (
  signatures: string[],
) => Promise<ReadonlyArray<SignatureStatusRow>>;

/**
 * Build the EVM write args. Sole construction site for the behavioural pin.
 * Do not invent a second functionName here.
 */
export function buildEvmMintPassportCall(args: {
  address: `0x${string}`;
  to: `0x${string}`;
  uri: string;
  chainId: number;
}): MintPassportEvmCall {
  return {
    address: args.address,
    abi: KarPassportAbi,
    functionName: "mintPassport",
    args: [args.to, args.uri],
    chainId: wagmiChainId(args.chainId),
  };
}

/**
 * Assemble the nine MintPassport metas in processor order
 * (entrypoint mint_passport): config, asset, state, payer, owner, freeze,
 * gateway_config, core, system.
 */
export function assembleMintPassportAccounts(args: {
  config: string;
  asset: string;
  state: string;
  payer: string;
  owner: string;
  freeze: string;
  gatewayConfig: string;
  core: string;
  system: string;
}): SvmWriteAccountMeta[] {
  return [
    { address: args.config, role: AccountRole.WRITABLE },
    { address: args.asset, role: AccountRole.WRITABLE },
    { address: args.state, role: AccountRole.WRITABLE },
    { address: args.payer, role: AccountRole.WRITABLE_SIGNER },
    { address: args.owner, role: AccountRole.READONLY },
    { address: args.freeze, role: AccountRole.READONLY },
    { address: args.gatewayConfig, role: AccountRole.READONLY },
    { address: args.core, role: AccountRole.READONLY },
    { address: args.system, role: AccountRole.READONLY },
  ];
}

const MINT_PASSPORT_CAUSE_COPY: Record<MintPassportCause, string> = {
  disconnected: "Connect a wallet to mint a passport.",
  wrong_vm: "Switch to a wallet that matches this network to mint a passport.",
  unresolved_namespace: unresolvedNamespaceCopy(),
  not_in_program: surfaceSupportCauseCopy("not_in_program"),
  product_owner_owed: surfaceSupportCauseCopy("product_owner_owed"),
  authority_only: surfaceSupportCauseCopy("authority_only"),
  passport_not_configured: "Passport contract not available on this network.",
  config_unavailable: "Passport config could not be read. Try again.",
  config_decode_failed: "Passport config on chain could not be decoded.",
  registry_bridge_gateway_mismatch:
    "Registry and on-chain bridge gateway disagree. Mint refused.",
  encode_failed: "Could not build the mint instruction.",
  pda_failed: "Could not derive mint accounts.",
  wallet_cannot_sign_and_send: "This wallet cannot sign and send on Solana.",
  no_connected_account: "Connect a Solana wallet to mint a passport.",
  send_failed: "Mint failed. Please try again.",
  mint_sequence_advanced:
    "Another mint landed first. Your metadata is kept — submit again.",
  unmapped_program_error: "Mint failed. Please try again.",
  missing_wallet_standard_chain: "Solana wallet chain is not configured.",
  wallet_returned_no_signature: "Wallet returned no signature.",
  blockhash_unavailable: "Network blockhash unavailable. Try again.",
  blockhash_expired: "Transaction expired. Try again.",
  unregistered_program: "Passport program is not registered for this network.",
  empty_instruction_data: "Mint instruction data is empty.",
};

export function mintPassportCauseCopy(cause: MintPassportCause): string {
  return MINT_PASSPORT_CAUSE_COPY[cause];
}

/** True when `err` is a Solana native InvalidSeeds InstructionError. */
export function isSvmInvalidSeedsError(err: unknown): boolean {
  if (err == null) return false;
  if (err === "InvalidSeeds") return true;
  if (typeof err === "string") {
    return (
      err === "InvalidSeeds" ||
      /\bInvalidSeeds\b/.test(err) ||
      err.includes('"InvalidSeeds"')
    );
  }
  if (typeof err !== "object") return false;
  const instructionError = (err as { InstructionError?: unknown })
    .InstructionError;
  if (Array.isArray(instructionError) && instructionError.length >= 2) {
    if (instructionError[1] === "InvalidSeeds") return true;
  }
  if (err instanceof Error) {
    return (
      /\bInvalidSeeds\b/.test(err.message) ||
      err.message.includes('"InvalidSeeds"')
    );
  }
  try {
    return JSON.stringify(err).includes("InvalidSeeds");
  } catch {
    return false;
  }
}

function bytesGt(a: Uint8Array, b: Uint8Array): boolean {
  const padA = a.length >= b.length ? a : prependZeros(a, b.length - a.length);
  const padB = b.length >= a.length ? b : prependZeros(b, a.length - b.length);
  for (let i = 0; i < padA.length; i++) {
    if (padA[i]! > padB[i]!) return true;
    if (padA[i]! < padB[i]!) return false;
  }
  return false;
}

function prependZeros(bytes: Uint8Array, n: number): Uint8Array {
  if (n <= 0) return bytes;
  const out = new Uint8Array(bytes.length + n);
  out.set(bytes, n);
  return out;
}

export type MintPassportDerivePda = (input: {
  recipe: string;
  programId: string;
  seeds?: Record<string, PdaSeedValue>;
}) => Promise<DeriveSvmPdaResult>;

function refusePlan(
  cause: MintPassportCause,
  detail: string,
  wanted?: WalletFamilyWanted,
): PlanMintPassportResult {
  return wanted != null
    ? { ok: false, cause, detail, wanted }
    : { ok: false, cause, detail };
}

export async function planMintPassport(input: {
  account: ActiveAccount;
  chainId: number;
  uri: string;
  registry?: CommercialRegistry;
  fetchAccountData?: FetchSvmAccountDataFn;
  /**
   * Stand / policy seam: force a stale next_token_id for concurrency proof.
   * Product path never passes this.
   */
  plannedNextTokenIdOverride?: Uint8Array;
  /**
   * Stand inject — local program ids are not in COMMERCIAL_ACTIVE.
   * Product path keeps the commercial registry gate ({@link deriveSvmPda}).
   */
  derivePda?: MintPassportDerivePda;
}): Promise<PlanMintPassportResult> {
  const avail = txWriteAvailabilityForCapability(
    input.account,
    "create_passport",
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
    return refusePlan(
      "unresolved_namespace",
      "commercial stack missing after availability admit",
    );
  }

  if (avail.vm === "evm") {
    if (stack.vm !== "evm") {
      return refusePlan("wrong_vm", "availability/stack vm mismatch", stack.vm);
    }
    if (input.account.status !== "connected" || input.account.vm !== "evm") {
      return refusePlan(
        "wrong_vm",
        "EVM plan requires connected EVM session",
        "evm",
      );
    }
    const address = karPassportAddress(input.chainId);
    if (address == null) {
      return refusePlan(
        "passport_not_configured",
        `no karPassport for chain ${input.chainId}`,
      );
    }
    const call = buildEvmMintPassportCall({
      address,
      to: input.account.address,
      uri: input.uri,
      chainId: input.chainId,
    });
    return { ok: true, vm: "evm", call };
  }

  if (stack.vm !== "svm") {
    return refusePlan("wrong_vm", "availability/stack vm mismatch", stack.vm);
  }

  return planSvmMintPassport({
    stack,
    account: input.account,
    uri: input.uri,
    fetchAccountData: input.fetchAccountData ?? fetchProductSvmAccountData,
    plannedNextTokenIdOverride: input.plannedNextTokenIdOverride,
    derivePda: input.derivePda ?? deriveSvmPda,
  });
}

async function planSvmMintPassport(args: {
  stack: SvmCommercialActiveStack;
  account: ActiveAccount;
  uri: string;
  fetchAccountData: FetchSvmAccountDataFn;
  plannedNextTokenIdOverride?: Uint8Array;
  derivePda: MintPassportDerivePda;
}): Promise<PlanMintPassportResult> {
  if (args.account.status !== "connected" || args.account.vm !== "svm") {
    return refusePlan(
      "wrong_vm",
      "SVM plan requires connected SVM session",
      "svm",
    );
  }

  const passportProgramId = args.stack.karPassport;
  const gatewayProgramId = args.stack.bridgeGateway;
  const derive = args.derivePda;

  const configPda = await derive({
    recipe: "kar-passport/config",
    programId: passportProgramId,
  });
  if (!configPda.ok) {
    return refusePlan("pda_failed", `${configPda.cause}:${configPda.detail}`);
  }

  const fetched = await args.fetchAccountData(configPda.address);
  if (!fetched.ok) {
    return refusePlan(
      "config_unavailable",
      `${fetched.cause}:${fetched.detail}`,
    );
  }

  const decoded = decodePassportConfig(fetched.value);
  if (!decoded.ok) {
    return refusePlan(
      "config_decode_failed",
      `${decoded.cause}:${decoded.detail}`,
    );
  }

  const plannedNextTokenId =
    args.plannedNextTokenIdOverride ??
    Uint8Array.from(decoded.value.nextTokenId);
  let plannedTokenId: string;
  try {
    plannedTokenId = tokenIdFromBytes32(plannedNextTokenId);
  } catch (err) {
    return refusePlan(
      "config_decode_failed",
      err instanceof Error ? err.message : String(err),
    );
  }

  const [assetPda, statePda, freezePda, gatewayConfigPda] = await Promise.all([
    derive({
      recipe: "kar-passport/asset",
      programId: passportProgramId,
      seeds: { token_id: plannedNextTokenId },
    }),
    derive({
      recipe: "kar-passport/state",
      programId: passportProgramId,
      seeds: { token_id: plannedNextTokenId },
    }),
    derive({
      recipe: "kar-gateway/freeze",
      programId: gatewayProgramId,
    }),
    derive({
      recipe: "kar-gateway/config",
      programId: gatewayProgramId,
    }),
  ]);

  for (const pda of [assetPda, statePda, freezePda, gatewayConfigPda]) {
    if (!pda.ok) {
      return refusePlan("pda_failed", `${pda.cause}:${pda.detail}`);
    }
  }
  if (
    !assetPda.ok ||
    !statePda.ok ||
    !freezePda.ok ||
    !gatewayConfigPda.ok
  ) {
    return refusePlan("pda_failed", "unreachable");
  }

  if (gatewayConfigPda.address !== decoded.value.bridgeGateway) {
    return refusePlan(
      "registry_bridge_gateway_mismatch",
      `registry config ${gatewayConfigPda.address} ≠ chain ${decoded.value.bridgeGateway}`,
    );
  }

  const encoded = encodeSvmInstruction({
    program: "kar-passport",
    variant: "MintPassport",
    fields: { uri: args.uri },
  });
  if (!encoded.ok) {
    return refusePlan(
      "encode_failed",
      `${encoded.cause}:${encoded.detail}`,
    );
  }

  const payer = args.account.address;
  const accounts = assembleMintPassportAccounts({
    config: configPda.address,
    asset: assetPda.address,
    state: statePda.address,
    payer,
    owner: payer,
    freeze: freezePda.address,
    gatewayConfig: gatewayConfigPda.address,
    core: mplCoreProgramId(),
    system: systemProgramId(),
  });

  return {
    ok: true,
    vm: "svm",
    plan: {
      programId: passportProgramId,
      data: encoded.data,
      accounts,
      feePayer: payer,
      plannedNextTokenId,
      plannedTokenId,
    },
  };
}

async function waitSignatureOutcome(args: {
  signature: string;
  getSignatureStatuses: GetSignatureStatusesFn;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<
  | { ok: true; slot: bigint }
  | { ok: false; err: unknown }
  | { ok: false; cause: "confirm_timeout"; detail: string }
> {
  const pollIntervalMs = args.pollIntervalMs ?? 400;
  const timeoutMs = args.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await args.getSignatureStatuses([args.signature]);
    if (row?.err != null) {
      return { ok: false, err: row.err };
    }
    const status = row?.confirmationStatus;
    if (status === "confirmed" || status === "finalized") {
      const slotRaw = row?.slot;
      const slot =
        typeof slotRaw === "bigint"
          ? slotRaw
          : typeof slotRaw === "number"
            ? BigInt(slotRaw)
            : 0n;
      return { ok: true, slot };
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return {
    ok: false,
    cause: "confirm_timeout",
    detail: `timed out after ${timeoutMs}ms`,
  };
}

async function classifyLandedMintFailure(args: {
  err: unknown;
  stack: SvmCommercialActiveStack;
  plannedNextTokenId: Uint8Array;
  fetchAccountData: FetchSvmAccountDataFn;
  derivePda: MintPassportDerivePda;
}): Promise<ExecuteMintPassportResult> {
  if (isSvmInvalidSeedsError(args.err)) {
    const configPda = await args.derivePda({
      recipe: "kar-passport/config",
      programId: args.stack.karPassport,
    });
    if (configPda.ok) {
      const fetched = await args.fetchAccountData(configPda.address);
      if (fetched.ok) {
        const decoded = decodePassportConfig(fetched.value);
        if (
          decoded.ok &&
          bytesGt(decoded.value.nextTokenId, args.plannedNextTokenId)
        ) {
          return {
            ok: false,
            cause: "mint_sequence_advanced",
            detail: `planned ${tokenIdFromBytes32(args.plannedNextTokenId)} advanced to ${tokenIdFromBytes32(decoded.value.nextTokenId)}`,
          };
        }
      }
    }
  }

  const decoded = decodeSvmProgramError(args.err);
  if (decoded != null) {
    const staticCopy = REVERT_COPY[decoded.name];
    if (staticCopy != null) {
      return {
        ok: false,
        cause: "send_failed",
        detail: staticCopy,
      };
    }
    return {
      ok: false,
      cause: "unmapped_program_error",
      detail: decoded.name,
    };
  }

  return {
    ok: false,
    cause: "send_failed",
    detail:
      args.err instanceof Error
        ? args.err.message
        : typeof args.err === "string"
          ? args.err
          : JSON.stringify(args.err),
  };
}

export async function executeMintPassport(input: {
  account: ActiveAccount;
  chainId: number;
  uri: string;
  writeEvmContract: WriteEvmContractFn;
  registry?: CommercialRegistry;
  svmPort?: SvmSignAndSendPort;
  fetchBlockhash?: Parameters<typeof sendSvmInstruction>[0]["fetchBlockhash"];
  fetchAccountData?: FetchSvmAccountDataFn;
  getSignatureStatuses?: GetSignatureStatusesFn;
  plannedNextTokenIdOverride?: Uint8Array;
  derivePda?: MintPassportDerivePda;
}): Promise<ExecuteMintPassportResult> {
  const derivePda = input.derivePda ?? deriveSvmPda;
  const planned = await planMintPassport({
    account: input.account,
    chainId: input.chainId,
    uri: input.uri,
    registry: input.registry,
    fetchAccountData: input.fetchAccountData,
    plannedNextTokenIdOverride: input.plannedNextTokenIdOverride,
    derivePda,
  });
  if (!planned.ok) {
    return {
      ok: false,
      cause: planned.cause,
      detail: planned.detail,
      ...(planned.wanted != null ? { wanted: planned.wanted } : {}),
    };
  }

  if (planned.vm === "evm") {
    try {
      const hash = await input.writeEvmContract(planned.call);
      return { ok: true, signature: hash };
    } catch (err) {
      if (isWalletRejection(err)) {
        return {
          ok: false,
          cause: "send_failed",
          detail: walletRejectionCopy(),
        };
      }
      return {
        ok: false,
        cause: "send_failed",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (input.svmPort == null) {
    return {
      ok: false,
      cause: "no_connected_account",
      detail: "svmPort required for SVM mint",
    };
  }

  const stack = commercialActive(input.chainId, input.registry);
  if (stack == null || stack.vm !== "svm") {
    return {
      ok: false,
      cause: "unresolved_namespace",
      detail: "SVM stack missing at execute",
    };
  }

  let sent;
  try {
    sent = await sendSvmInstruction({
      stack,
      programId: planned.plan.programId,
      data: planned.plan.data,
      accounts: planned.plan.accounts,
      feePayer: planned.plan.feePayer,
      port: input.svmPort,
      fetchBlockhash: input.fetchBlockhash,
    });
  } catch (err) {
    if (isWalletRejection(err)) {
      return {
        ok: false,
        cause: "send_failed",
        detail: walletRejectionCopy(),
      };
    }
    return classifyLandedMintFailure({
      err,
      stack,
      plannedNextTokenId: planned.plan.plannedNextTokenId,
      fetchAccountData: input.fetchAccountData ?? fetchProductSvmAccountData,
      derivePda,
    });
  }

  if (!sent.ok) {
    return {
      ok: false,
      cause: sent.cause,
      detail: sent.detail,
    };
  }

  const getStatuses = input.getSignatureStatuses;
  if (getStatuses == null) {
    // Product path: classification deferred to confirm inside runTx when no
    // status injector — still return signature for lifecycle. Concurrency
    // classification requires getSignatureStatuses (stand / tests inject it;
    // product wizard injects via createProduct statuses in the hook).
    return {
      ok: true,
      signature: sent.signature,
      plannedTokenId: planned.plan.plannedTokenId,
    };
  }

  const outcome = await waitSignatureOutcome({
    signature: sent.signature,
    getSignatureStatuses: getStatuses,
  });
  if (outcome.ok) {
    return {
      ok: true,
      signature: sent.signature,
      plannedTokenId: planned.plan.plannedTokenId,
    };
  }
  if ("cause" in outcome) {
    return {
      ok: false,
      cause: "send_failed",
      detail: outcome.detail,
    };
  }
  return classifyLandedMintFailure({
    err: outcome.err,
    stack,
    plannedNextTokenId: planned.plan.plannedNextTokenId,
    fetchAccountData: input.fetchAccountData ?? fetchProductSvmAccountData,
    derivePda,
  });
}
