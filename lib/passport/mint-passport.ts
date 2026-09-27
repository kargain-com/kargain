/**
 * Sole dual-VM owner for product Create mint.
 *
 * Plan + send only. Confirmation is the product SVM confirm port via `runTx`
 * (lifecycle). Concurrent mint races are classified by
 * {@link classifyMintLandedError} after a landed Outcome.
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
import { REVERT_COPY } from "@/lib/marketplace/tx-error-message";
import {
  svmConfirmExpiredCopy,
  svmConfirmStatusUnknownCopy,
} from "@/lib/web3/svm-confirm-copy";
import {
  type SvmLandedInstructionError,
} from "@/lib/web3/svm-landed-error";
import type { TxRefusal } from "@/lib/web3/tx-refusal";
import { isWalletRejection } from "@/lib/web3/wallet-rejection";
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
import type { WriteSubmission } from "@/lib/web3/write-outcome";
import {
  txWriteAvailabilityForCapability,
  txWriteGuardRefusalCopy,
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
  /** Config PDA address — for post-confirm fresh reads. */
  configAddress: string;
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
  | "wallet_rejected"
  | "send_failed"
  | "write_guard_refused"
  | "mint_sequence_advanced"
  | "expired"
  | "status_unknown"
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

export type SendMintPassportResult =
  | { ok: true; submission: WriteSubmission; plannedTokenId?: string }
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
  wallet_rejected:
    "You cancelled the wallet request. Nothing was submitted.",
  send_failed: "Mint failed. Please try again.",
  write_guard_refused: "Mint could not start. Check your wallet and network.",
  mint_sequence_advanced:
    "Another mint landed first. Your metadata is kept — submit again.",
  expired: svmConfirmExpiredCopy(),
  status_unknown: svmConfirmStatusUnknownCopy(),
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

export type ClassifyMintLandedCause =
  | "mint_sequence_advanced"
  | "unmapped_program_error"
  | { kind: "mapped"; name: string; copy: string };

/**
 * Pure classifier for a landed mint TransactionError + fresh next_token_id.
 * Caller performs the keyed config read; this never polls or invents.
 */
export function classifyMintLandedError(
  landed: SvmLandedInstructionError | null,
  plannedNextTokenId: Uint8Array,
  freshNextTokenId: Uint8Array,
): ClassifyMintLandedCause {
  if (
    landed?.kind === "native" &&
    landed.name === "InvalidSeeds" &&
    bytesGt(freshNextTokenId, plannedNextTokenId)
  ) {
    return "mint_sequence_advanced";
  }
  if (landed?.kind === "custom") {
    const copy = REVERT_COPY[landed.name];
    if (copy != null) {
      return { kind: "mapped", name: landed.name, copy };
    }
  }
  return "unmapped_program_error";
}

/** Map classifier result to a mint cause + owner sentence (never raw detail). */
export function mintCauseFromLandedClassification(
  classified: ClassifyMintLandedCause,
): { cause: MintPassportCause; copy: string } {
  if (classified === "mint_sequence_advanced") {
    return {
      cause: "mint_sequence_advanced",
      copy: mintPassportCauseCopy("mint_sequence_advanced"),
    };
  }
  if (classified === "unmapped_program_error") {
    return {
      cause: "unmapped_program_error",
      copy: mintPassportCauseCopy("unmapped_program_error"),
    };
  }
  return { cause: "send_failed", copy: classified.copy };
}

async function readFreshNextTokenId(input: {
  configAddress: string;
  fetchAccountData?: FetchSvmAccountDataFn;
}): Promise<
  | { ok: true; nextTokenId: Uint8Array }
  | { ok: false; cause: "config_unavailable" | "config_decode_failed" }
> {
  const fetch = input.fetchAccountData ?? fetchProductSvmAccountData;
  const fetched = await fetch(input.configAddress);
  if (!fetched.ok) {
    return { ok: false, cause: "config_unavailable" };
  }
  const decoded = decodePassportConfig(fetched.value);
  if (!decoded.ok) {
    return { ok: false, cause: "config_decode_failed" };
  }
  return { ok: true, nextTokenId: decoded.value.nextTokenId };
}

/**
 * Map a {@link TxRefusal} to mint cause + owner sentence.
 * Wizard branches on causes only — no RPC, no `"plan" in` probes.
 *
 * Landed path: InvalidSeeds + advanced next → mint_sequence_advanced.
 * Preflight/send refuse: advanced next alone → mint_sequence_advanced.
 * Classify `write_refused.error` only via typed guards — never err.message.
 */
export async function resolveMintRefusal(input: {
  plan: PlanMintPassportResult & { ok: true };
  refusal: TxRefusal;
  fetchAccountData?: FetchSvmAccountDataFn;
}): Promise<{ cause: MintPassportCause; copy: string }> {
  const { refusal } = input;

  if (refusal.kind === "wallet_rejected") {
    return {
      cause: "wallet_rejected",
      copy: mintPassportCauseCopy("wallet_rejected"),
    };
  }
  if (refusal.kind === "expired") {
    return {
      cause: "expired",
      copy: mintPassportCauseCopy("expired"),
    };
  }
  if (refusal.kind === "status_unknown") {
    return {
      cause: "status_unknown",
      copy: mintPassportCauseCopy("status_unknown"),
    };
  }
  if (refusal.kind === "guard_refused") {
    return {
      cause: "write_guard_refused",
      copy: txWriteGuardRefusalCopy(refusal.refusal),
    };
  }

  if (input.plan.vm !== "svm") {
    // EVM cannot produce an SVM landed confirm Outcome.
    if (refusal.kind === "landed_with_error") {
      return {
        cause: "unmapped_program_error",
        copy: mintPassportCauseCopy("unmapped_program_error"),
      };
    }
    if (refusal.kind === "write_refused") {
      if (isWalletRejection(refusal.error)) {
        return {
          cause: "wallet_rejected",
          copy: mintPassportCauseCopy("wallet_rejected"),
        };
      }
      if (isMintPassportSendRefusal(refusal.error)) {
        return {
          cause: refusal.error.mintCause,
          copy: mintPassportCauseCopy(refusal.error.mintCause),
        };
      }
    }
    return {
      cause: "send_failed",
      copy: mintPassportCauseCopy("send_failed"),
    };
  }

  const plannedNext = input.plan.plan.plannedNextTokenId;
  const configAddress = input.plan.plan.configAddress;

  if (refusal.kind === "landed_with_error") {
    const fresh = await readFreshNextTokenId({
      configAddress,
      fetchAccountData: input.fetchAccountData,
    });
    if (!fresh.ok) {
      return {
        cause: fresh.cause,
        copy: mintPassportCauseCopy(fresh.cause),
      };
    }
    return mintCauseFromLandedClassification(
      classifyMintLandedError(refusal.landed, plannedNext, fresh.nextTokenId),
    );
  }

  // write_refused — send or preflight threw a typed value.
  if (refusal.kind === "write_refused") {
    if (isWalletRejection(refusal.error)) {
      return {
        cause: "wallet_rejected",
        copy: mintPassportCauseCopy("wallet_rejected"),
      };
    }
    if (isMintPassportSendRefusal(refusal.error)) {
      return {
        cause: refusal.error.mintCause,
        copy: mintPassportCauseCopy(refusal.error.mintCause),
      };
    }
  }

  const fresh = await readFreshNextTokenId({
    configAddress,
    fetchAccountData: input.fetchAccountData,
  });
  if (fresh.ok && bytesGt(fresh.nextTokenId, plannedNext)) {
    return {
      cause: "mint_sequence_advanced",
      copy: mintPassportCauseCopy("mint_sequence_advanced"),
    };
  }
  return {
    cause: "send_failed",
    copy: mintPassportCauseCopy("send_failed"),
  };
}

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
    derivePda: input.derivePda ?? deriveSvmPda,
  });
}

async function planSvmMintPassport(args: {
  stack: SvmCommercialActiveStack;
  account: ActiveAccount;
  uri: string;
  fetchAccountData: FetchSvmAccountDataFn;
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

  const plannedNextTokenId = Uint8Array.from(decoded.value.nextTokenId);
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
      configAddress: configPda.address,
    },
  };
}

export async function sendMintPassport(input: {
  plan: PlanMintPassportResult & { ok: true };
  account: ActiveAccount;
  chainId: number;
  writeEvmContract: WriteEvmContractFn;
  registry?: CommercialRegistry;
  svmPort?: SvmSignAndSendPort;
  fetchBlockhash?: Parameters<typeof sendSvmInstruction>[0]["fetchBlockhash"];
}): Promise<SendMintPassportResult> {
  const planned = input.plan;

  if (planned.vm === "evm") {
    try {
      const hash = await input.writeEvmContract(planned.call);
      return { ok: true, submission: hash };
    } catch (err) {
      if (isWalletRejection(err)) {
        return {
          ok: false,
          cause: "wallet_rejected",
          detail: "wallet_rejected",
        };
      }
      return {
        ok: false,
        cause: "send_failed",
        detail: "send_failed",
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
      detail: "SVM stack missing at send",
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
        cause: "wallet_rejected",
        detail: "wallet_rejected",
      };
    }
    return {
      ok: false,
      cause: "send_failed",
      detail: "send_failed",
    };
  }

  if (!sent.ok) {
    return {
      ok: false,
      cause: sent.cause,
      detail: sent.detail,
    };
  }

  return {
    ok: true,
    submission: sent.submission,
    plannedTokenId: planned.plan.plannedTokenId,
  };
}

/**
 * Typed throw for send refusals inside `runTx` writeFn.
 * Carries {@link MintPassportCause}; {@link resolveMintRefusal} reads
 * {@link MintPassportSendRefusal.mintCause} from `write_refused.error`.
 */
export class MintPassportSendRefusal extends Error {
  readonly mintCause: MintPassportCause;

  constructor(cause: MintPassportCause) {
    super(cause);
    this.name = "MintPassportSendRefusal";
    this.mintCause = cause;
  }
}

export function isMintPassportSendRefusal(
  err: unknown,
): err is MintPassportSendRefusal {
  return err instanceof MintPassportSendRefusal;
}
