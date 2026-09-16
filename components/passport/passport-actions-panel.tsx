"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useSignMessage } from "wagmi";

import { EvidenceInput } from "@/components/passport/evidence-input";
import { MetadataDiffPanel } from "@/components/passport/metadata-diff-panel";
import { EvmSessionRefusal } from "@/components/shell/evm-session-refusal";
import { TxWriteRefusal } from "@/components/shell/tx-write-refusal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useActiveVerifierFact } from "@/hooks/use-active-verifier-fact";
import { useAppendPassportAttestation } from "@/hooks/use-append-passport-attestation";
import { useAppendPassportRecord } from "@/hooks/use-append-passport-record";
import { useReportPassportDiscrepancy } from "@/hooks/use-report-passport-discrepancy";
import { useVerifyPassport } from "@/hooks/use-verify-passport";
import { useChallengeBondAmount } from "@/hooks/use-challenge-bond-amount";
import { useOpenChallenge } from "@/hooks/use-open-challenge";
import { useJudgeChallenge } from "@/hooks/use-judge-challenge";
import { useConcludeChallenge } from "@/hooks/use-conclude-challenge";
import { useWithdrawChallenge } from "@/hooks/use-withdraw-challenge";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { useNow } from "@/hooks/use-now";
import {
  elevatedAdvisoryPanel,
  elevatedAdvisoryText,
} from "@/lib/design/instrument-classes";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
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
import { challengeBondDisclosure } from "@/lib/passport/challenge-bond-disclosure";
import {
  preparePassportRecordWrite,
  passportRecordWritePrepRefusalMessage,
} from "@/lib/passport/prepare-passport-record-write";
import {
  OWNER_SERVICE_RECORD_TYPES,
  type OwnerServiceRecordType,
} from "@/lib/passport/record-types";
import { revealPassportRecordsTab } from "@/lib/passport/passport-tab-url";
import { uploadEvidenceFile } from "@/lib/passport/upload-evidence";
import type { PassportStatus, PonderUriHistoryEntry } from "@/lib/types/ponder";
import { cn } from "@/lib/utils";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import {
  commercialActive,
  nativeUnitOf,
} from "@/lib/web3/commercial-active";
import { formatNativeAmountLabeled } from "@/lib/web3/native-amount";
import { writeOutcomeHasClaimRecipient } from "@/lib/web3/write-outcome";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { useKeyedReadContracts } from "@/lib/web3/keyed-multicall";
import { usePassportCommerceFacts } from "@/hooks/use-passport-commerce-facts";
import { txWriteAvailability } from "@/lib/web3/tx-write-availability";

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
  const { account, signingBinding, svmWallet } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const sessionAddress =
    account.status === "connected" ? account.address : undefined;
  const connector = signingBinding.ok ? signingBinding.connector : undefined;
  const { signMessageAsync } = useSignMessage();
  const {
    appendPassportRecord,
    isPending: appendPending,
  } = useAppendPassportRecord();
  const {
    reportPassportDiscrepancy,
    isPending: reportPending,
  } = useReportPassportDiscrepancy();
  const {
    appendPassportAttestation,
    isPending: attestationPending,
  } = useAppendPassportAttestation();
  const {
    verifyPassport,
    isPending: verifyPending,
  } = useVerifyPassport();
  const {
    openChallenge,
    isPending: openChallengePending,
  } = useOpenChallenge();
  const {
    judgeChallenge,
    isPending: judgeChallengePending,
  } = useJudgeChallenge();
  const {
    concludeChallenge,
    isPending: concludeChallengePending,
  } = useConcludeChallenge();
  const {
    withdrawChallenge,
    isPending: withdrawChallengePending,
  } = useWithdrawChallenge();
  const { isActiveVerifier } = useActiveVerifierFact({ chainId });
  const writeAvail = txWriteAvailability(account, chainId);
  const bondDisclosure = challengeBondDisclosure(chainId);
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
  /** EVM hex address or any commercial stack (SVM program id) — no VM fork. */
  const writeTargetConfigured =
    passport != null || commercialActive(chainId) != null;
  const wc = wagmiChainId(chainId);
  const tid = BigInt(tokenId);

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

  const { disputeDeposit, disputeDepositLoading } = useChallengeBondAmount({
    chainId,
    enabled: bondDisclosure.configured,
  });

  const { onChainOwner } = usePassportOnChainOwner(chainId, tokenId);
  const effectiveOwner = resolveEffectiveOnChainOwner(onChainOwner, passportOwner);

  const isOwner = isOnChainNftOwner(sessionAddress, effectiveOwner);
  const holder = isPassportHolder({
    address: sessionAddress,
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
    wallet: sessionAddress,
    isOwner,
    holder,
    isActiveVerifier,
    status,
    listingActive: Boolean(listingActive),
  });
  const exclusionCopy = actionSurface.challenge.exclusionCopy;

  const resolveRecordEvidenceCid = useCallback(
    async (file: File | null, paste: string): Promise<string> => {
      if (file) {
        setIsUploadingEvidence(true);
        try {
          return await uploadEvidenceFile(file, {
            account,
            evmConnector: connector ?? undefined,
            svmWallet,
          });
        } finally {
          setIsUploadingEvidence(false);
        }
      }
      return paste.trim();
    },
    [account, connector, svmWallet],
  );

  const submitOwnerRecord = useCallback(async () => {
    const description = recordDescription.trim();
    if (description.length < 10 || !writeTargetConfigured) return;

    const result = await runTx(async () => {
      const prep = await preparePassportRecordWrite({
        account,
        targetChainId: chainId,
        evidenceFile: recordEvidenceFile,
        signMessageAsync,
      });
      if (!prep.ok) {
        throw new Error(passportRecordWritePrepRefusalMessage(prep));
      }
      const evidenceCid = await resolveRecordEvidenceCid(
        recordEvidenceFile,
        recordEvidencePaste,
      );
      return appendPassportRecord({
        chainId,
        tokenId,
        recordType,
        description,
        evidenceCid,
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
    account,
    appendPassportRecord,
    chainId,
    pathname,
    recordDescription,
    recordEvidenceFile,
    recordEvidencePaste,
    recordType,
    resolveRecordEvidenceCid,
    runTx,
    signMessageAsync,
    tokenId,
    writeTargetConfigured,
  ]);

  const submitDiscrepancy = useCallback(async () => {
    const description = discrepancyText.trim();
    if (!description || !writeTargetConfigured) return;

    const result = await runTx(async () => {
      const prep = await preparePassportRecordWrite({
        account,
        targetChainId: chainId,
        evidenceFile: discrepancyEvidenceFile,
        signMessageAsync,
      });
      if (!prep.ok) {
        throw new Error(passportRecordWritePrepRefusalMessage(prep));
      }
      const evidenceCid = await resolveRecordEvidenceCid(
        discrepancyEvidenceFile,
        discrepancyEvidencePaste,
      );
      return reportPassportDiscrepancy({
        chainId,
        tokenId,
        description,
        evidenceCid,
      });
    });
    if (result) {
      setDiscrepancyText("");
      setDiscrepancyEvidencePaste("");
      setDiscrepancyEvidenceFile(null);
      setMessage("Discrepancy reported.");
    }
  }, [
    account,
    chainId,
    discrepancyEvidenceFile,
    discrepancyEvidencePaste,
    discrepancyText,
    reportPassportDiscrepancy,
    resolveRecordEvidenceCid,
    runTx,
    signMessageAsync,
    tokenId,
    writeTargetConfigured,
  ]);

  const submitClarification = useCallback(async () => {
    const description = clarificationText.trim();
    if (!description || !writeTargetConfigured) return;

    const result = await runTx(async () => {
      const prep = await preparePassportRecordWrite({
        account,
        targetChainId: chainId,
        evidenceFile: clarificationEvidenceFile,
        signMessageAsync,
      });
      if (!prep.ok) {
        throw new Error(passportRecordWritePrepRefusalMessage(prep));
      }
      const evidenceCid = await resolveRecordEvidenceCid(
        clarificationEvidenceFile,
        clarificationEvidencePaste,
      );
      return appendPassportRecord({
        chainId,
        tokenId,
        recordType: "dispute-clarification",
        description,
        evidenceCid,
      });
    });
    if (result) {
      setClarificationText("");
      setClarificationEvidencePaste("");
      setClarificationEvidenceFile(null);
      setMessage("Clarification appended.");
    }
  }, [
    account,
    appendPassportRecord,
    chainId,
    clarificationEvidenceFile,
    clarificationEvidencePaste,
    clarificationText,
    resolveRecordEvidenceCid,
    runTx,
    signMessageAsync,
    tokenId,
    writeTargetConfigured,
  ]);

  const submitAttestation = useCallback(async () => {
    const description = attestationText.trim();
    if (!description || !writeTargetConfigured) return;

    const result = await runTx(async () => {
      const prep = await preparePassportRecordWrite({
        account,
        targetChainId: chainId,
        evidenceFile: attestationEvidenceFile,
        signMessageAsync,
      });
      if (!prep.ok) {
        throw new Error(passportRecordWritePrepRefusalMessage(prep));
      }
      const evidenceCid = await resolveRecordEvidenceCid(
        attestationEvidenceFile,
        attestationEvidencePaste,
      );
      return appendPassportAttestation({
        chainId,
        tokenId,
        description,
        evidenceCid,
      });
    });
    if (result) {
      setAttestationText("");
      setAttestationEvidencePaste("");
      setAttestationEvidenceFile(null);
      setMessage("Attestation appended.");
    }
  }, [
    account,
    appendPassportAttestation,
    attestationEvidenceFile,
    attestationEvidencePaste,
    attestationText,
    chainId,
    resolveRecordEvidenceCid,
    runTx,
    signMessageAsync,
    tokenId,
    writeTargetConfigured,
  ]);

  const submitVerify = useCallback(async () => {
    if (!writeTargetConfigured) return;
    const result = await runTx(() =>
      verifyPassport({ chainId, tokenId }),
    );
    if (result) {
      setMessage("Passport verified.");
    }
  }, [chainId, runTx, tokenId, verifyPassport, writeTargetConfigured]);

  const submitOpen = useCallback(async () => {
    if (!writeTargetConfigured) return;
    const result = await runTx(() =>
      openChallenge({ chainId, tokenId, disputeDeposit }),
    );
    if (result) {
      setMessage("Dispute opened.");
    }
  }, [
    chainId,
    disputeDeposit,
    openChallenge,
    runTx,
    tokenId,
    writeTargetConfigured,
  ]);

  const submitWithdraw = useCallback(async () => {
    if (!writeTargetConfigured || !bondDisclosure.configured) return;
    const result = await runTx(() =>
      withdrawChallenge({ chainId, tokenId }),
    );
    if (!result) return;
    const undeliverable = bondDisclosure.undeliverableBondOutcome;
    if (
      undeliverable.claimPossible &&
      sessionAddress &&
      writeOutcomeHasClaimRecipient(result, sessionAddress)
    ) {
      setMessage(undeliverable.claimSuccessCopy);
    } else {
      setMessage(bondDisclosure.releasedSuccessCopy);
    }
  }, [
    bondDisclosure,
    chainId,
    runTx,
    sessionAddress,
    tokenId,
    withdrawChallenge,
    writeTargetConfigured,
  ]);

  const submitJudge = useCallback(
    async (outcome: 0 | 1, successMessage: string) => {
      if (!writeTargetConfigured || !bondDisclosure.configured) return;
      const result = await runTx(() =>
        judgeChallenge({ chainId, tokenId, outcome }),
      );
      if (result) {
        setMessage(successMessage);
      }
    },
    [
      bondDisclosure.configured,
      chainId,
      judgeChallenge,
      runTx,
      tokenId,
      writeTargetConfigured,
    ],
  );

  const submitConclude = useCallback(async () => {
    if (!writeTargetConfigured || !bondDisclosure.configured) return;
    const result = await runTx(() =>
      concludeChallenge({ chainId, tokenId }),
    );
    if (result) {
      setMessage(
        "Challenge concluded. Verification lapsed — a fresh inspection restores it.",
      );
    }
  }, [
    bondDisclosure.configured,
    chainId,
    concludeChallenge,
    runTx,
    tokenId,
    writeTargetConfigured,
  ]);

  const actionsBusy =
    appendPending ||
    reportPending ||
    attestationPending ||
    verifyPending ||
    openChallengePending ||
    judgeChallengePending ||
    concludeChallengePending ||
    withdrawChallengePending ||
    isUploadingEvidence ||
    phase !== "idle";

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
      {!writeAvail.available && (
        <TxWriteRefusal
          refusal={writeAvail}
          disconnectedTitle="Connect your wallet to add records or clarifications."
        />
      )}

      {!evm.ok && (
        <EvmSessionRefusal
          cause={evm.cause}
          disconnectedTitle="Connect your wallet to verify, dispute, or interact with this passport."
        />
      )}

      {evm.ok && !passport && (
        <p className="text-sm text-text-secondary">Passport contract not configured.</p>
      )}

      {(writeTargetConfigured || (passport && evm.ok)) && (
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

      {passport && evm.ok && isAvailable(actionSurface.editMetadata) && (
        <Button asChild variant="secondary" className="w-full">
          <Link href={`/passport/${tokenId}/edit?chain=${chainId}`}>Edit metadata</Link>
        </Button>
      )}

      {passport && evm.ok && isAvailable(actionSurface.editMetadata) && status === "VERIFIED" && (
        <p className="text-xs text-text-secondary">
          Editing anchor fields while verified will reset verification status.
        </p>
      )}

      {writeAvail.available &&
        writeTargetConfigured &&
        isAvailable(actionSurface.verify) && (
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
            onClick={() => void submitVerify()}
          >
            Verify passport
          </Button>
        </div>
      )}

      {writeAvail.available &&
        writeTargetConfigured &&
        bondDisclosure.configured &&
        isAvailable(actionSurface.open) && (
        <div className="space-y-2">
          {bondDisclosure.requiresAmountKnownBeforeSubmit &&
          disputeDepositLoading ? (
            <p className="text-xs text-text-secondary">Loading deposit requirement…</p>
          ) : (
            <p className="text-xs text-text-secondary">
              {bondDisclosure.amountSource.status === "readable" &&
              disputeDeposit != null ? (
                <>
                  Opening locks a{" "}
                  {formatNativeAmountLabeled(
                    disputeDeposit,
                    nativeUnitOf(commercialActive(chainId)!),
                  )}{" "}
                  deposit for the challenge window.{" "}
                </>
              ) : null}
              {bondDisclosure.deliverySentence}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            className="w-full border-status-error text-status-error"
            disabled={
              actionsBusy ||
              (bondDisclosure.requiresAmountKnownBeforeSubmit &&
                (disputeDepositLoading || disputeDeposit === undefined))
            }
            onClick={() => void submitOpen()}
          >
            Open challenge
          </Button>
        </div>
      )}

      {passport &&
        evm.ok &&
        status === "DISPUTED" &&
        actionSurface.presence.status === "here" && (
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

      {writeAvail.available &&
        writeTargetConfigured &&
        bondDisclosure.configured &&
        isAvailable(actionSurface.judge) && (
        <div className="flex flex-col gap-2">
          <div className="space-y-2 rounded-md border border-border-default bg-bg-primary/80 p-3">
            <p className="text-xs text-text-secondary">
              {actionSurface.challenge.terminals.upheld.judgeCopy}
            </p>
            <Button
              type="button"
              disabled={actionsBusy}
              onClick={() =>
                void submitJudge(
                  0,
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
                void submitJudge(
                  1,
                  "Challenge rejected. Verification stands.",
                )
              }
            >
              Reject challenge
            </Button>
          </div>
        </div>
      )}

      {writeAvail.available &&
        writeTargetConfigured &&
        bondDisclosure.configured &&
        isAvailable(actionSurface.withdraw) && (
        <div className="space-y-2">
          <p className="text-xs text-text-secondary">
            {actionSurface.challenge.terminals.withdrawn.withdrawCopy}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={actionsBusy}
            onClick={() => void submitWithdraw()}
          >
            Withdraw my challenge
          </Button>
        </div>
      )}

      {writeAvail.available &&
        writeTargetConfigured &&
        bondDisclosure.configured &&
        isAvailable(actionSurface.conclude) && (
        <div className="space-y-2">
          <p className="text-xs text-text-secondary">
            {actionSurface.challenge.terminals.expired.concludeCopy}
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={actionsBusy}
            onClick={() => void submitConclude()}
          >
            Conclude challenge
          </Button>
        </div>
      )}

      {writeAvail.available &&
        writeTargetConfigured &&
        isAvailable(actionSurface.ownerClarification) && (
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

      {writeAvail.available &&
        writeTargetConfigured &&
        listingActive &&
        holder &&
        actionSurface.presence.status === "here" && (
        <p className="text-xs text-text-secondary">
          Service records can be added after delisting.
        </p>
      )}

      {writeAvail.available &&
        writeTargetConfigured &&
        isAvailable(actionSurface.appendRecord) && (
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

      {writeAvail.available &&
        writeTargetConfigured &&
        isAvailable(actionSurface.appendAttestation) && (
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

      {writeAvail.available &&
        writeTargetConfigured &&
        isAvailable(actionSurface.reportDiscrepancy) && (
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
