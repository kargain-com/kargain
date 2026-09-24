/**
 * Sole product owner: simulate PassportIx::May and map the outcome to an
 * EncumbrancePermissionGate (S8-D1 9.3c).
 *
 * Does not re-implement may.rs. Instruction bytes from encodeSvmInstruction;
 * PDAs from deriveSvmPda; RPC via postSolanaJsonRpc only. The only product
 * module that may call simulateTransaction.
 */

import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  blockhash as assertBlockhash,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";

import { ENCUMBRANCE_INTENT } from "@/lib/commerce/consignment";
import { AVAILABLE } from "@/lib/challenge/action-gate";
import type { EncumbrancePermissionGate } from "@/lib/passport/encumbrance-permission";
import type { EncumbranceSourceDecoded } from "@/lib/svm/decode-account-state";
import { encodeSvmInstruction } from "@/lib/svm/encode-instruction";
import { deriveSvmPda, type DeriveSvmPdaResult } from "@/lib/svm/derive-pda";
import { tokenIdToBytes32 } from "@/lib/svm/event-payload-decode";
import { postSolanaJsonRpc } from "@/lib/svm/solana-json-rpc";
import type { ActiveAccount } from "@/lib/web3/active-account";
import {
  commercialActive,
  type CommercialRegistry,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import type { KeyedEntry } from "@/lib/web3/keyed-multicall";
import { productSvmRpcUrl } from "@/lib/web3/svm-rpc";
import { encumbranceSourcesFromConfigEntry } from "@/lib/passport/passport-commerce-facts";

/** LeaveChain / OpenConsignment as carried by PassportIx::May. */
export type PassportMayIntent =
  | typeof ENCUMBRANCE_INTENT.LeaveChain
  | typeof ENCUMBRANCE_INTENT.OpenConsignment;

export type SimulatePassportMayDerivePda = (input: {
  recipe: string;
  programId: string;
  seeds?: Record<string, string | number | Uint8Array>;
}) => Promise<DeriveSvmPdaResult>;

export type SimulatePassportMayArgs = {
  stack: SvmCommercialActiveStack;
  tokenId: string;
  intent: PassportMayIntent;
  /** Connected SVM session address — sole fee-payer source. */
  feePayer: string;
  /** Registry order from decodePassportConfig (prefixes required). */
  sources: readonly EncumbranceSourceDecoded[];
  /** Inject for stand / tests. Default: product public RPC. */
  rpcUrl?: string;
  /** Inject JSON-RPC (tests / stand). Default: postSolanaJsonRpc. */
  postRpc?: typeof postSolanaJsonRpc;
  /**
   * Inject PDA derive for local-validator program ids (stand).
   * Default: {@link deriveSvmPda} (commercial registry only).
   */
  derivePda?: SimulatePassportMayDerivePda;
};

export type SimulatePassportMayResult =
  | { ok: true; gate: EncumbrancePermissionGate }
  | { ok: false; gate: EncumbrancePermissionGate };

type SimValue = {
  err: unknown;
  logs?: string[] | null;
};

/**
 * Fee payer for May simulate: connected SVM session address only.
 * Disconnected / wrong family → fee_payer_required (never a substitute).
 */
export function resolveMaySimulateFeePayer(
  account: ActiveAccount,
):
  | { ok: true; feePayer: string }
  | { ok: false; gate: EncumbrancePermissionGate } {
  if (account.status !== "connected" || account.vm !== "svm") {
    return {
      ok: false,
      gate: { status: "blocked", cause: "fee_payer_required" },
    };
  }
  if (!account.address || account.address.trim().length === 0) {
    return {
      ok: false,
      gate: { status: "blocked", cause: "fee_payer_required" },
    };
  }
  return { ok: true, feePayer: account.address };
}

/**
 * Pure map from simulateTransaction `value.err` → permission gate.
 * Exported for planted red→green coverage; product path goes through
 * {@link simulatePassportMay}.
 */
export function mapMaySimulateErr(err: unknown): EncumbrancePermissionGate {
  if (err == null) {
    return AVAILABLE;
  }
  if (typeof err === "string") {
    if (err === "AccountNotFound" || err === "InvalidAccountForFee") {
      return { status: "blocked", cause: "simulation_unavailable" };
    }
    if (err === "InvalidSeeds") {
      return { status: "blocked", cause: "construction" };
    }
    return { status: "blocked", cause: "simulation_unavailable" };
  }
  if (typeof err !== "object") {
    return { status: "blocked", cause: "simulation_unavailable" };
  }
  const instructionError = (err as { InstructionError?: unknown })
    .InstructionError;
  if (!Array.isArray(instructionError) || instructionError.length < 2) {
    return { status: "blocked", cause: "simulation_unavailable" };
  }
  const detail = instructionError[1];
  if (detail === "InvalidSeeds") {
    return { status: "blocked", cause: "construction" };
  }
  if (
    detail != null &&
    typeof detail === "object" &&
    "Custom" in detail &&
    typeof (detail as { Custom: unknown }).Custom === "number"
  ) {
    const code = (detail as { Custom: number }).Custom;
    if (code === 37 || code === 70) {
      return { status: "blocked", cause: "refused" };
    }
    if (code === 20) {
      return {
        status: "blocked",
        cause: "source_unanswerable",
        source: { presence: "not_carried_by_vm" },
      };
    }
    if (code === 0) {
      return { status: "blocked", cause: "construction" };
    }
    return { status: "blocked", cause: "construction" };
  }
  return { status: "blocked", cause: "simulation_unavailable" };
}

async function buildMayWire(args: {
  stack: SvmCommercialActiveStack;
  tokenId: string;
  intent: PassportMayIntent;
  feePayer: string;
  sources: readonly EncumbranceSourceDecoded[];
  blockhash: string;
  lastValidBlockHeight: bigint;
  derivePda: SimulatePassportMayDerivePda;
}): Promise<
  | { ok: true; wireBase64: string }
  | { ok: false; gate: EncumbrancePermissionGate }
> {
  const passport = args.stack.karPassport;
  const derive = args.derivePda;
  let tokenBytes: Uint8Array;
  try {
    tokenBytes = tokenIdToBytes32(args.tokenId);
  } catch {
    return { ok: false, gate: { status: "blocked", cause: "construction" } };
  }

  const encoded = encodeSvmInstruction({
    program: "kar-passport",
    variant: "May",
    fields: { token_id: tokenBytes, intent: args.intent },
  });
  if (!encoded.ok) {
    return { ok: false, gate: { status: "blocked", cause: "construction" } };
  }

  const configPda = await derive({
    recipe: "kar-passport/config",
    programId: passport,
  });
  if (!configPda.ok) {
    return { ok: false, gate: { status: "blocked", cause: "construction" } };
  }
  const assetPda = await derive({
    recipe: "kar-passport/asset",
    programId: passport,
    seeds: { token_id: tokenBytes },
  });
  if (!assetPda.ok) {
    return { ok: false, gate: { status: "blocked", cause: "construction" } };
  }
  const challengePda = await derive({
    recipe: "kargain-bonded-challenge/challenge",
    programId: passport,
    seeds: { subject_id: tokenBytes },
  });
  if (!challengePda.ok) {
    return { ok: false, gate: { status: "blocked", cause: "construction" } };
  }

  const readonly = AccountRole.READONLY;
  const accounts: { address: Address; role: typeof readonly }[] = [
    { address: configPda.address, role: readonly },
    { address: assetPda.address, role: readonly },
    { address: challengePda.address, role: readonly },
  ];

  for (const source of args.sources) {
    const answer = await derive({
      recipe: "kargain-encumbrance/answer",
      programId: source.programId,
      seeds: {
        seed_prefix: source.seedPrefix,
        token_id: tokenBytes,
        intent: args.intent,
      },
    });
    if (!answer.ok) {
      return { ok: false, gate: { status: "blocked", cause: "construction" } };
    }
    accounts.push({ address: answer.address, role: readonly });
  }

  let feePayerAddr: Address;
  let programAddress: Address;
  try {
    feePayerAddr = address(args.feePayer);
    programAddress = address(passport);
  } catch {
    return { ok: false, gate: { status: "blocked", cause: "construction" } };
  }

  let lifetimeBlockhash;
  try {
    lifetimeBlockhash = assertBlockhash(args.blockhash);
  } catch {
    return {
      ok: false,
      gate: { status: "blocked", cause: "simulation_unavailable" },
    };
  }

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayerAddr, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: lifetimeBlockhash,
          lastValidBlockHeight: args.lastValidBlockHeight,
        },
        m,
      ),
    (m) =>
      appendTransactionMessageInstruction(
        {
          programAddress,
          accounts,
          data: encoded.data,
        },
        m,
      ),
  );
  const compiled = compileTransaction(message);
  return {
    ok: true,
    wireBase64: getBase64EncodedWireTransaction(compiled),
  };
}

/**
 * Simulate PassportIx::May for one intent. Fail closed on every non-null err.
 */
export async function simulatePassportMay(
  args: SimulatePassportMayArgs,
): Promise<SimulatePassportMayResult> {
  const rpcUrl = args.rpcUrl ?? productSvmRpcUrl();
  if (rpcUrl == null || rpcUrl.length === 0) {
    return {
      ok: false,
      gate: { status: "blocked", cause: "simulation_unavailable" },
    };
  }

  const post = args.postRpc ?? postSolanaJsonRpc;
  let blockhash: string;
  let lastValidBlockHeight: bigint;
  try {
    const bh = await post<{
      value: { blockhash: string; lastValidBlockHeight: number | string };
    }>(rpcUrl, "getLatestBlockhash", [{ commitment: "confirmed" }]);
    blockhash = bh.value.blockhash;
    lastValidBlockHeight = BigInt(bh.value.lastValidBlockHeight);
  } catch {
    return {
      ok: false,
      gate: { status: "blocked", cause: "simulation_unavailable" },
    };
  }

  const wire = await buildMayWire({
    stack: args.stack,
    tokenId: args.tokenId,
    intent: args.intent,
    feePayer: args.feePayer,
    sources: args.sources,
    blockhash,
    lastValidBlockHeight,
    derivePda: args.derivePda ?? deriveSvmPda,
  });
  if (!wire.ok) {
    return { ok: false, gate: wire.gate };
  }

  try {
    const result = await post<{ value: SimValue }>(
      rpcUrl,
      "simulateTransaction",
      [
        wire.wireBase64,
        {
          encoding: "base64",
          sigVerify: false,
          replaceRecentBlockhash: true,
          commitment: "confirmed",
        },
      ],
    );
    const gate = mapMaySimulateErr(result.value.err);
    return gate.status === "available"
      ? { ok: true, gate }
      : { ok: false, gate };
  } catch {
    return {
      ok: false,
      gate: { status: "blocked", cause: "simulation_unavailable" },
    };
  }
}

/**
 * Both intents for commerce facts. Same fee payer and sources for both.
 */
export async function simulatePassportMayPermissions(args: {
  stack: SvmCommercialActiveStack;
  tokenId: string;
  feePayer: string;
  sources: readonly EncumbranceSourceDecoded[];
  rpcUrl?: string;
  postRpc?: typeof postSolanaJsonRpc;
  derivePda?: SimulatePassportMayDerivePda;
}): Promise<{
  openConsignmentPermission: EncumbrancePermissionGate;
  leaveChainPermission: EncumbrancePermissionGate;
}> {
  const [leave, open] = await Promise.all([
    simulatePassportMay({
      ...args,
      intent: ENCUMBRANCE_INTENT.LeaveChain,
    }),
    simulatePassportMay({
      ...args,
      intent: ENCUMBRANCE_INTENT.OpenConsignment,
    }),
  ]);
  return {
    leaveChainPermission: leave.gate,
    openConsignmentPermission: open.gate,
  };
}

export type MaySimulateReady = {
  kind: "simulate";
  key: string;
  stack: SvmCommercialActiveStack;
  tokenId: string;
  feePayer: string;
  sources: readonly EncumbranceSourceDecoded[];
};

export type MayPermissionsPair = {
  openConsignmentPermission: EncumbrancePermissionGate;
  leaveChainPermission: EncumbrancePermissionGate;
};

const PENDING_MAY_PAIR: MayPermissionsPair = {
  openConsignmentPermission: { status: "blocked", cause: "reads_unresolved" },
  leaveChainPermission: { status: "blocked", cause: "reads_unresolved" },
};

const UNAVAILABLE_MAY_PAIR: MayPermissionsPair = {
  openConsignmentPermission: {
    status: "blocked",
    cause: "simulation_unavailable",
  },
  leaveChainPermission: {
    status: "blocked",
    cause: "simulation_unavailable",
  },
};

export type MaySimulateDecision =
  | { kind: "omit" }
  | { kind: "ready"; key: string; value: MayPermissionsPair }
  | MaySimulateReady;

/**
 * Sync decision for SVM May simulate: omit on non-SVM plan, ready gate when
 * fee payer / config / stack refuse, or simulate when all inputs are present.
 * Hook stays blind to `vm` literals.
 */
export function decideMaySimulate(args: {
  enabled: boolean;
  planVm: "evm" | "svm" | null | undefined;
  planNamespace: number | undefined;
  planTokenId: string | undefined;
  planning: boolean;
  batchPending: boolean;
  account: ActiveAccount;
  depsKey: string;
  configEntry: KeyedEntry | undefined;
  registry?: CommercialRegistry;
}): MaySimulateDecision {
  const feePayerKey =
    args.account.status === "connected" && args.account.vm === "svm"
      ? args.account.address
      : "none";
  const mayKey = `${args.depsKey}:${feePayerKey}`;

  if (!args.enabled || args.planVm !== "svm") {
    return { kind: "omit" };
  }
  if (args.planning || args.batchPending) {
    return { kind: "ready", key: mayKey, value: PENDING_MAY_PAIR };
  }
  const fee = resolveMaySimulateFeePayer(args.account);
  if (!fee.ok) {
    return {
      kind: "ready",
      key: mayKey,
      value: {
        openConsignmentPermission: fee.gate,
        leaveChainPermission: fee.gate,
      },
    };
  }
  const sources = encumbranceSourcesFromConfigEntry(args.configEntry);
  if (sources == null) {
    return { kind: "ready", key: mayKey, value: PENDING_MAY_PAIR };
  }
  if (args.planNamespace == null || args.planTokenId == null) {
    return { kind: "ready", key: mayKey, value: UNAVAILABLE_MAY_PAIR };
  }
  const stack = commercialActive(args.planNamespace, args.registry);
  if (stack?.vm !== "svm") {
    return { kind: "ready", key: mayKey, value: UNAVAILABLE_MAY_PAIR };
  }
  return {
    kind: "simulate",
    key: mayKey,
    stack,
    tokenId: args.planTokenId,
    feePayer: fee.feePayer,
    sources,
  };
}
