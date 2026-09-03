"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatEther } from "viem";
import { useReadContract, useSignMessage, useWriteContract } from "wagmi";

import { EvidenceInput } from "@/components/passport/evidence-input";
import { MetadataDiffPanel } from "@/components/passport/metadata-diff-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/textarea";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { useNow } from "@/hooks/use-now";
import { receiptHasClaimForAccount } from "@/lib/claims/receipt-claims";
import { ensureSiweSession } from "@/lib/auth/ensure-siwe-session";
import {
  elevatedAdvisoryPanel,
  elevatedAdvisoryText,
} from "@/lib/design/instrument-classes";
import {
  KarPassportAbi,
  KarProStakingAbi,
} from "@/lib/contracts/abis.generated";
import { formatReturnCountdown } from "@/lib/marketplace/return-cooldown";
import type { PassportMetadata } from "@/lib/passport/fetch-arweave-metadata";
import { usePassportOnChainOwner } from "@/hooks/use-passport-on-chain-owner";
import {
  isOnChainNftOwner,
  isPassportHolder,
  resolveEffectiveOnChainOwner,
} from "@/lib/passport/passport-owner";
import {
  VERIFICATION_INSTANCE,
  deriveChallengeSurface,
  parseChallenge,
} from "@/lib/challenge";
import {
  derivePassportActionSurface,
  isAvailable,
} from "@/lib/passport/action-surface";
import {
  OWNER_SERVICE_RECORD_TYPES,
  type OwnerServiceRecordType,
} from "@/lib/passport/record-types";
import { revealPassportRecordsTab } from "@/lib/passport/passport-tab-url";
import {
  getWalletUploadProvider,
} from "@/lib/passport/upload-passport-metadata";
import { uploadEvidenceFile } from "@/lib/passport/upload-evidence";
import type { PassportStatus, PonderUriHistoryEntry } from "@/lib/types/ponder";
import { cn } from "@/lib/utils";
import {
  karPassportAddress,
  karProStakingAddress,
} from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { useKeyedReadContracts } from "@/lib/web3/keyed-multicall";
import { usePassportCommerceFacts } from "@/hooks/use-passport-commerce-facts";

type Props = {
  tokenId: string;
  /** Chain this panel acts on (view / commerce chain). */
  chainId: number;
  /** Ponder usable-copy location — presence input. Defaults to `chainId`. */
  ponderCustodyChain?: number;
  /** Fold incomplete cause from indexer. */
  custodyUnresolved?: string | null;
  passportOwner: `0x${string}`;
  status: PassportStatus;
  lastDisputer: string;
  /** Recorded verifier while disputed (passport.verifier). */
  recordedVerifier: string;
  disputeOpenedAt: string;
  duplicateVin: boolean;
  listingActive?: boolean;
  listingSeller?: `0x${string}`;
  tokenUri: string;
  currentMetadata: PassportMetadata | null;
  uriHistory: PonderUriHistoryEntry[];
  verificationResetCount: number;
  lastVerificationResetAt: string;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  embeddedInSheet?: boolean;
};

export function PassportActionsPanel({
  tokenId,
  chainId,
  ponderCustodyChain,
  custodyUnresolved,
  passportOwner,
  status,
  lastDisputer,
  recordedVerifier,
  disputeOpenedAt,
  duplicateVin,
  listingActive,
  listingSeller,
  tokenUri,
  currentMetadata,
  uriHistory,
  verificationResetCount,
  lastVerificationResetAt,
  onDirtyChange,
  onBusyChange,
  embeddedInSheet = false,
}: Props) {
  const pathname = usePathname();
  const { account, signingBinding } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const isConnected = evm.ok;
  const connector = signingBinding.ok ? signingBinding.connector : undefined;
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync, isPending } = useWriteContract();
  const { runTx, phase, error, syncLagged } = useTxSync(chainId);
  const [clarificationText, setClarificationText] = useState("");
  const [discrepancyText, setDiscrepancyText] = useState("");
  const [discrepancyEvidencePaste, setDiscrepancyEvidencePaste] = useState("");
  const [discrepancyEvidenceFile, setDiscrepancyEvidenceFile] = useState<File | null>(
    null,
  );
  const [clarificationEvidencePaste, setClarificationEvidencePaste] = useState("");
  const [clarificationEvidenceFile, setClarificationEvidenceFile] = useState<File | null>(
    null,
  );
  const [attestationText, setAttestationText] = useState("");
  const [attestationEvidencePaste, setAttestationEvidencePaste] = useState("");
  const [attestationEvidenceFile, setAttestationEvidenceFile] = useState<File | null>(
    null,
  );
  const [isUploadingEvidence, setIsUploadingEvidence] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recordFormOpen, setRecordFormOpen] = useState(false);
  const [recordType, setRecordType] = useState<OwnerServiceRecordType>("service");
  const [recordDescription, setRecordDescription] = useState("");
  const [recordEvidencePaste, setRecordEvidencePaste] = useState("");
  const [recordEvidenceFile, setRecordEvidenceFile] = useState<File | null>(null);

  const passport = karPassportAddress(chainId);
  const staking = karProStakingAddress(chainId);
  const wc = wagmiChainId(chainId);
  const tid = BigInt(tokenId);

  const verifierReads = useKeyedReadContracts({
    contracts:
      passport && staking && address
        ? [
            {
              key: "isActiveVerifier" as const,
              address: staking,
              abi: KarProStakingAbi,
              functionName: "isActiveVerifier",
              args: [address],
              chainId: wc,
            },
          ]
        : [],
  });

  const disputeReads = useKeyedReadContracts({
    contracts: passport
      ? [
          {
            key: "disputeWindow" as const,
            address: passport,
            abi: KarPassportAbi,
            functionName: "DISPUTE_WINDOW",
            chainId: wc,
          },
          {
            key: "challengeOpenedAt" as const,
            address: passport,
            abi: KarPassportAbi,
            functionName: "challengeOpenedAt",
            args: [tid],
            chainId: wc,
          },
        ]
      : [],
  });

  const { data: disputeDepositRaw, isLoading: disputeDepositLoading } = useReadContract({
    address: passport ?? undefined,
    abi: KarPassportAbi,
    functionName: "disputeDeposit",
    chainId: wc,
    query: { enabled: Boolean(passport) },
  });
  const disputeDeposit =
    disputeDepositRaw != null ? BigInt(disputeDepositRaw) : undefined;

  const { onChainOwner } = usePassportOnChainOwner(chainId, tokenId);
  const effectiveOwner = resolveEffectiveOnChainOwner(onChainOwner, passportOwner);

  const verifierEntry = verifierReads.entry("isActiveVerifier");
  const isActiveVerifier: boolean | undefined =
    verifierEntry?.status === "success"
      ? verifierEntry.result === true
      : address
        ? undefined
        : false;

  const isOwner = isOnChainNftOwner(address, effectiveOwner);
  const holder = isPassportHolder({
    address,
    onChainOwner,
    ponderOwner: passportOwner,
    listingActive,
    listingSeller,
  });

  const disputeWindowEntry = disputeReads.entry("disputeWindow");
  const challengeOpenedEntry = disputeReads.entry("challengeOpenedAt");
  const chainWindowSec =
    disputeWindowEntry?.status === "success" && disputeWindowEntry.result != null
      ? Number(disputeWindowEntry.result)
      : undefined;
  const chainOpenedAt =
    challengeOpenedEntry?.status === "success" &&
    challengeOpenedEntry.result != null
      ? Number(challengeOpenedEntry.result)
      : 0;
  const indexerOpenedAt = Number.parseInt(disputeOpenedAt, 10);
  const effectiveOpenedAt =
    chainOpenedAt > 0
      ? chainOpenedAt
      : Number.isFinite(indexerOpenedAt) && indexerOpenedAt > 0
        ? indexerOpenedAt
        : 0;

  const challenge =
    status === "DISPUTED" && effectiveOpenedAt > 0
      ? parseChallenge(tokenId, {
          challenger: lastDisputer,
          openedAt: effectiveOpenedAt,
          windowDuration: chainWindowSec,
          bondAmount: disputeDeposit ?? 0n,
        })
      : null;

  const nowSec = useNow(status === "DISPUTED" ? 1_000 : 60_000);
  const challengeSurface = deriveChallengeSurface(VERIFICATION_INSTANCE, {
    challenge,
    wallet: address,
    isActiveVerifier,
    passportStatus: status,
    owner: passportOwner,
    recordedVerifier,
    opener: lastDisputer,
    nowSec,
    requireDisputedStatus: true,
  });

  const commerceFacts = usePassportCommerceFacts({
    chainId,
    tokenId,
    enabled: Boolean(passport),
  });
  const actionSurface = derivePassportActionSurface({
    presenceFacts: {
      viewChainId: chainId,
      custodyLocked: commerceFacts.custodyLocked,
      ponderCustodyChain: ponderCustodyChain ?? chainId,
      custodyUnresolved: custodyUnresolved ?? null,
    },
    challenge: challengeSurface,
    wallet: address,
    isOwner,
    holder,
    isActiveVerifier,
    status,
    listingActive: Boolean(listingActive),
  });
  const exclusionCopy = actionSurface.challenge.exclusionCopy;

  const run = useCallback(
    async (
      fn: () => Promise<`0x${string}`>,
      success: string,
      claimSuccess?: string,
    ) => {
      if (!passport) return;
      const result = await runTx(fn);
      if (!result) return;
      if (
        claimSuccess &&
        address &&
        receiptHasClaimForAccount(result.receipt, address)
      ) {
        setMessage(claimSuccess);
      } else {
        setMessage(success);
      }
    },
    [address, passport, runTx],
  );

  const resolveAttestationEvidence = useCallback(async (): Promise<string> => {
    if (attestationEvidenceFile) {
      if (!address) throw new Error("Connect your wallet to continue");
      setIsUploadingEvidence(true);
      try {
        await ensureSiweSession({
          address,
          chainId,
          signMessageAsync,
        });
        const provider = await getWalletUploadProvider(connector ?? undefined);
        return await uploadEvidenceFile(attestationEvidenceFile, provider);
      } finally {
        setIsUploadingEvidence(false);
      }
    }
    return attestationEvidencePaste.trim();
  }, [
    address,
    attestationEvidenceFile,
    attestationEvidencePaste,
    chainId,
    connector,
    signMessageAsync,
  ]);

  const uploadEvidenceFromInput = useCallback(
    async (file: File | null, paste: string): Promise<string> => {
      if (file) {
        if (!address) throw new Error("Connect your wallet to continue");
        setIsUploadingEvidence(true);
        try {
          await ensureSiweSession({
            address,
            chainId,
            signMessageAsync,
          });
          const provider = await getWalletUploadProvider(connector ?? undefined);
          return await uploadEvidenceFile(file, provider);
        } finally {
          setIsUploadingEvidence(false);
        }
      }
      return paste.trim();
    },
    [address, chainId, connector, signMessageAsync],
  );

  const resolveDiscrepancyEvidence = useCallback(
    () => uploadEvidenceFromInput(discrepancyEvidenceFile, discrepancyEvidencePaste),
    [discrepancyEvidenceFile, discrepancyEvidencePaste, uploadEvidenceFromInput],
  );

  const resolveClarificationEvidence = useCallback(
    () => uploadEvidenceFromInput(clarificationEvidenceFile, clarificationEvidencePaste),
    [clarificationEvidenceFile, clarificationEvidencePaste, uploadEvidenceFromInput],
  );

  const resolveOwnerRecordEvidence = useCallback(
    () => uploadEvidenceFromInput(recordEvidenceFile, recordEvidencePaste),
    [recordEvidenceFile, recordEvidencePaste, uploadEvidenceFromInput],
  );

  const submitOwnerRecord = useCallback(async () => {
    const description = recordDescription.trim();
    if (description.length < 10 || !passport) return;

    const result = await runTx(async () => {
      const evidenceCID = await resolveOwnerRecordEvidence();
      return writeContractAsync({
        address: passport,
        abi: KarPassportAbi,
        functionName: "appendRecord",
        args: [tid, recordType, description, evidenceCID],
        chainId: wc,
      });
    });
    if (result) {
      setRecordFormOpen(false);
      setRecordType("service");
      setRecordDescription("");
      setRecordEvidencePaste("");
      setRecordEvidenceFile(null);
      revealPassportRecordsTab(pathname);
    }
  }, [
    passport,
    pathname,
    recordDescription,
    recordType,
    resolveOwnerRecordEvidence,
    runTx,
    tid,
    wc,
    writeContractAsync,
  ]);

  const submitDiscrepancy = useCallback(async () => {
    const description = discrepancyText.trim();
    if (!description || !passport) return;

    const result = await runTx(async () => {
      const evidenceCID = await resolveDiscrepancyEvidence();
      return writeContractAsync({
        address: passport,
        abi: KarPassportAbi,
        functionName: "reportDiscrepancy",
        args: [tid, description, evidenceCID],
        chainId: wc,
      });
    });
    if (result) {
      setDiscrepancyText("");
      setDiscrepancyEvidencePaste("");
      setDiscrepancyEvidenceFile(null);
      setMessage("Discrepancy reported.");
    }
  }, [
    discrepancyText,
    passport,
    resolveDiscrepancyEvidence,
    runTx,
    tid,
    wc,
    writeContractAsync,
  ]);

  const submitClarification = useCallback(async () => {
    const description = clarificationText.trim();
    if (!description || !passport) return;

    const result = await runTx(async () => {
      const evidenceCID = await resolveClarificationEvidence();
      return writeContractAsync({
        address: passport,
        abi: KarPassportAbi,
        functionName: "appendRecord",
        args: [tid, "dispute-clarification", description, evidenceCID],
        chainId: wc,
      });
    });
    if (result) {
      setClarificationText("");
      setClarificationEvidencePaste("");
      setClarificationEvidenceFile(null);
      setMessage("Clarification appended.");
    }
  }, [
    clarificationText,
    passport,
    resolveClarificationEvidence,
    runTx,
    tid,
    wc,
    writeContractAsync,
  ]);

  const submitAttestation = useCallback(async () => {
    const description = attestationText.trim();
    if (!description || !passport) return;

    const result = await runTx(async () => {
      const evidenceCID = await resolveAttestationEvidence();
      return writeContractAsync({
        address: passport,
        abi: KarPassportAbi,
        functionName: "appendAttestation",
        args: [tid, description, evidenceCID],
        chainId: wc,
      });
    });
    if (result) {
      setAttestationText("");
      setAttestationEvidencePaste("");
      setAttestationEvidenceFile(null);
      setMessage("Attestation appended.");
    }
  }, [
    attestationText,
    passport,
    resolveAttestationEvidence,
    runTx,
    tid,
    wc,
    writeContractAsync,
  ]);

  const actionsBusy = isPending || isUploadingEvidence || phase !== "idle";

  const actionsDirty =
    Boolean(
      clarificationText.trim() ||
        discrepancyText.trim() ||
        discrepancyEvidencePaste.trim() ||
        discrepancyEvidenceFile ||
        clarificationEvidencePaste.trim() ||
        clarificationEvidenceFile ||
        attestationText.trim() ||
        attestationEvidencePaste.trim() ||
        attestationEvidenceFile ||
        recordFormOpen ||
        recordDescription.trim() ||
        recordEvidencePaste.trim() ||
        recordEvidenceFile,
    );

  useEffect(() => {
    onDirtyChange?.(actionsDirty);
  }, [actionsDirty, onDirtyChange]);

  useEffect(() => {
    onBusyChange?.(actionsBusy);
  }, [actionsBusy, onBusyChange]);

  return (
    <>
      {!isConnected && (
        <div className="space-y-3">
          <EmptyState
            variant="infrastructure"
            level="B"
            title="Connect your wallet to verify, dispute, or interact with this passport."
          />
          <WalletLoginButton />
        </div>
      )}

      {isConnected && !passport && (
        <p className="text-sm text-text-secondary">Passport contract not configured.</p>
      )}

      {passport && (
    <section className="space-y-4 rounded-md border border-border-default bg-bg-surface p-6">
      {!embeddedInSheet && (
        <h2 className="font-sans text-base font-medium text-text-primary">Actions</h2>
      )}

      {duplicateVin && (
        <p className={cn(elevatedAdvisoryPanel, elevatedAdvisoryText)} role="status">
          Duplicate VIN warning — another passport shares this VIN in the index. Review metadata
          carefully before buying or verifying.
        </p>
      )}

      {actionSurface.presenceCopy ? (
        <p className="text-sm text-text-secondary" role="status">
          {actionSurface.presenceCopy}
        </p>
      ) : null}

      {isAvailable(actionSurface.editMetadata) && (
        <Button asChild variant="secondary" className="w-full">
          <Link href={`/passport/${tokenId}/edit?chain=${chainId}`}>Edit metadata</Link>
        </Button>
      )}

      {isAvailable(actionSurface.editMetadata) && status === "VERIFIED" && (
        <p className="text-xs text-text-secondary">
          Editing anchor fields while verified will reset verification status.
        </p>
      )}

      {isAvailable(actionSurface.verify) && (
        <div className="space-y-3">
          <MetadataDiffPanel
            chainId={chainId}
            uriHistory={uriHistory}
            currentTokenUri={tokenUri}
            currentMetadata={currentMetadata}
            verificationResetCount={verificationResetCount}
            lastVerificationResetAt={lastVerificationResetAt}
          />
          <Button
            type="button"
            className="w-full"
            disabled={actionsBusy}
            onClick={() =>
              void run(
                () =>
                  writeContractAsync({
                    address: passport,
                    abi: KarPassportAbi,
                    functionName: "verifyPassport",
                    args: [tid],
                    chainId: wc,
                  }),
                "Passport verified.",
              )
            }
          >
            Verify passport
          </Button>
        </div>
      )}

      {isAvailable(actionSurface.open) && (
        <div className="space-y-2">
          {disputeDepositLoading ? (
            <p className="text-xs text-text-secondary">Loading deposit requirement…</p>
          ) : disputeDeposit != null ? (
            <p className="text-xs text-text-secondary">
              Opening locks a {formatEther(disputeDeposit)} ETH deposit for the challenge
              window. Withdraw before the window ends returns it to you. Uphold returns it to
              the opener. Reject or expiry sends it to the platform. If a return cannot be
              delivered, it waits under Claims.
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="w-full border-status-error text-status-error"
            disabled={
              actionsBusy ||
              disputeDepositLoading ||
              disputeDeposit === undefined
            }
            onClick={() =>
              void run(
                () =>
                  writeContractAsync({
                    address: passport!,
                    abi: KarPassportAbi,
                    functionName: "open",
                    args: [tid],
                    value: disputeDeposit,
                    chainId: wc,
                  }),
                "Dispute opened.",
              )
            }
          >
            Open challenge
          </Button>
        </div>
      )}

      {status === "DISPUTED" && actionSurface.presence.status === "here" && (
        <div className="space-y-3 rounded-md border border-border-default bg-bg-primary/80 p-3">
          {actionSurface.challenge.phase === "active" && (
            <p className="text-sm text-text-secondary">
              Challenge window ends{" "}
              <time
                className="font-mono tabular-nums text-text-primary"
                dateTime={new Date(actionSurface.challenge.windowEndsAt * 1000).toISOString()}
              >
                {new Date(actionSurface.challenge.windowEndsAt * 1000).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
              {" · "}
              <span className="font-mono tabular-nums">
                {formatReturnCountdown(BigInt(actionSurface.challenge.windowRemainingSec))}
              </span>{" "}
              left. If no independent KarPro decides by then, verification lapses and the deposit
              goes to the platform.
            </p>
          )}
          {actionSurface.challenge.phase === "elapsed" && (
            <p className="text-sm text-text-secondary">
              The challenge window has ended. Anyone may conclude so verification
              lapses. The deposit goes to the platform. Judging is no longer available.
            </p>
          )}
          {exclusionCopy && (
            <p className="text-sm text-text-secondary">{exclusionCopy}</p>
          )}
        </div>
      )}

      {isAvailable(actionSurface.judge) && (
        <div className="flex flex-col gap-2">
          <div className="space-y-2 rounded-md border border-border-default bg-bg-primary/80 p-3">
            <p className="text-xs text-text-secondary">
              {actionSurface.challenge.terminals.upheld.judgeCopy}
            </p>
            <Button
              type="button"
              disabled={actionsBusy}
              onClick={() =>
                void run(
                  () =>
                    writeContractAsync({
                      address: passport!,
                      abi: KarPassportAbi,
                      functionName: "judge",
                      args: [tid, 0],
                      chainId: wc,
                    }),
                  "Challenge upheld. Passport is now unverified.",
                )
              }
            >
              Uphold challenge
            </Button>
          </div>
          <div className="space-y-2 rounded-md border border-border-default bg-bg-primary/80 p-3">
            <p className="text-xs text-text-secondary">
              {actionSurface.challenge.terminals.rejected.judgeCopy}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={actionsBusy}
              onClick={() =>
                void run(
                  () =>
                    writeContractAsync({
                      address: passport!,
                      abi: KarPassportAbi,
                      functionName: "judge",
                      args: [tid, 1],
                      chainId: wc,
                    }),
                  "Challenge rejected. Verification stands.",
                )
              }
            >
              Reject challenge
            </Button>
          </div>
        </div>
      )}

      {isAvailable(actionSurface.withdraw) && (
        <div className="space-y-2">
          <p className="text-xs text-text-secondary">
            {actionSurface.challenge.terminals.withdrawn.withdrawCopy}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={actionsBusy}
            onClick={() =>
              void run(
                () =>
                  writeContractAsync({
                    address: passport!,
                    abi: KarPassportAbi,
                    functionName: "withdraw",
                    args: [tid],
                    chainId: wc,
                  }),
                "Challenge withdrawn. Your deposit was released.",
                "Challenge withdrawn. Your deposit could not be delivered and is waiting under Claims.",
              )
            }
          >
            Withdraw my challenge
          </Button>
        </div>
      )}

      {isAvailable(actionSurface.conclude) && (
        <div className="space-y-2">
          <p className="text-xs text-text-secondary">
            {actionSurface.challenge.terminals.expired.concludeCopy}
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={actionsBusy}
            onClick={() =>
              void run(
                () =>
                  writeContractAsync({
                    address: passport!,
                    abi: KarPassportAbi,
                    functionName: "conclude",
                    args: [tid],
                    chainId: wc,
                  }),
                "Challenge concluded. Verification lapsed — a fresh inspection restores it.",
              )
            }
          >
            Conclude challenge
          </Button>
        </div>
      )}

      {isAvailable(actionSurface.ownerClarification) && (
        <div className="space-y-2">
          <Label htmlFor="clarification">Owner clarification</Label>
          <Textarea
            id="clarification"
            value={clarificationText}
            onChange={(e) => setClarificationText(e.target.value)}
            rows={3}
          />
          <EvidenceInput
            idPrefix="clarification-evidence"
            value={clarificationEvidencePaste}
            onChange={setClarificationEvidencePaste}
            file={clarificationEvidenceFile}
            onFileChange={setClarificationEvidenceFile}
            disabled={actionsBusy}
            labels={{
              evidenceLabel: "Evidence (optional)",
              evidenceHint: "Paste an ar:// or https:// link, or upload a file.",
              evidencePlaceholder: "ar://… or https://…",
              evidenceFileLabel: "Upload file",
            }}
          />
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={actionsBusy || !clarificationText.trim()}
            onClick={() => void submitClarification()}
          >
            Append clarification
          </Button>
        </div>
      )}

      {listingActive && holder && actionSurface.presence.status === "here" && (
        <p className="text-xs text-text-secondary">
          Service records can be added after delisting.
        </p>
      )}

      {isAvailable(actionSurface.appendRecord) && (
        <div className="space-y-2 border-t border-border-default pt-4">
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start px-0 hover:bg-transparent"
            onClick={() => {
              setRecordFormOpen((open) => !open);
            }}
          >
            Add record +
          </Button>
          {recordFormOpen && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {OWNER_SERVICE_RECORD_TYPES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={recordType === option.value}
                    disabled={actionsBusy}
                    onClick={() => setRecordType(option.value)}
                    className={cn(
                      "font-mono text-xs uppercase tracking-wider border rounded-sm px-3 py-1.5 cursor-pointer transition-colors duration-200",
                      recordType === option.value
                        ? "border-accent-warm text-accent-warm"
                        : "border-border-default text-text-secondary",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="owner-record-description">Description</Label>
                <Textarea
                  id="owner-record-description"
                  value={recordDescription}
                  onChange={(e) => setRecordDescription(e.target.value)}
                  placeholder="Describe the service, repair, or event…"
                  rows={3}
                  disabled={actionsBusy}
                />
                {recordDescription.length > 500 && (
                  <p className="text-xs text-text-secondary">
                    {recordDescription.length} characters
                  </p>
                )}
              </div>
              <EvidenceInput
                idPrefix="owner-record-evidence"
                value={recordEvidencePaste}
                onChange={setRecordEvidencePaste}
                file={recordEvidenceFile}
                onFileChange={setRecordEvidenceFile}
                disabled={actionsBusy}
                labels={{
                  evidenceLabel: "Evidence (optional)",
                  evidenceHint: "Paste an ar:// or https:// link, or upload a file.",
                  evidencePlaceholder: "ar://… or https://…",
                  evidenceFileLabel: "Upload file",
                }}
              />
              <Button
                type="button"
                className="w-full"
                disabled={actionsBusy || recordDescription.trim().length < 10}
                aria-busy={actionsBusy}
                onClick={() => void submitOwnerRecord()}
              >
                {actionsBusy ? "Adding record…" : "Add record"}
              </Button>
            </div>
          )}
        </div>
      )}

      {isAvailable(actionSurface.appendAttestation) && (
        <div className="space-y-2 border-t border-border-default pt-4">
          <Label htmlFor="attestation-text">Verifier attestation</Label>
          <p className="text-xs text-text-secondary">
            Public on-chain note from an active verifier. Does not change passport status.
          </p>
          <Textarea
            id="attestation-text"
            value={attestationText}
            onChange={(e) => setAttestationText(e.target.value)}
            placeholder="Inspection notes, mileage confirmation, condition summary…"
            rows={3}
            disabled={actionsBusy}
          />
          <EvidenceInput
            idPrefix="attestation-evidence"
            value={attestationEvidencePaste}
            onChange={setAttestationEvidencePaste}
            file={attestationEvidenceFile}
            onFileChange={setAttestationEvidenceFile}
            disabled={actionsBusy}
            labels={{
              evidenceLabel: "Evidence (optional)",
              evidenceHint: "Paste an ar:// or https:// link, or upload a file.",
              evidencePlaceholder: "ar://… or https://…",
              evidenceFileLabel: "Upload file",
            }}
          />
          <Button
            type="button"
            className="w-full"
            disabled={actionsBusy || !attestationText.trim()}
            onClick={() => void submitAttestation()}
          >
            Append attestation
          </Button>
        </div>
      )}

      {isAvailable(actionSurface.reportDiscrepancy) && (
      <div className="space-y-2 border-t border-border-default pt-4">
        <Label htmlFor="discrepancy">Report discrepancy</Label>
        <Textarea
          id="discrepancy"
          value={discrepancyText}
          onChange={(e) => setDiscrepancyText(e.target.value)}
          rows={2}
        />
        <EvidenceInput
          idPrefix="discrepancy-evidence"
          value={discrepancyEvidencePaste}
          onChange={setDiscrepancyEvidencePaste}
          file={discrepancyEvidenceFile}
          onFileChange={setDiscrepancyEvidenceFile}
          disabled={actionsBusy}
          labels={{
            evidenceLabel: "Evidence (optional)",
            evidenceHint: "Paste an ar:// or https:// link, or upload a file.",
            evidencePlaceholder: "ar://… or https://…",
            evidenceFileLabel: "Upload file",
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={actionsBusy || !discrepancyText.trim()}
          onClick={() => void submitDiscrepancy()}
        >
          Report discrepancy
        </Button>
      </div>
      )}

      {(error ?? message) && (
        <p className="text-sm text-text-secondary" role="status">
          {error ?? message}
        </p>
      )}
      {syncLagged && (
        <p role="status" className="font-sans text-xs text-text-tertiary">
          {TX_SYNC_LAG_ADVISORY}
        </p>
      )}
    </section>
      )}
    </>
  );
}
