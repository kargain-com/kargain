"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatEther } from "viem";
import {
  useAccount,
  useReadContract,
  useSignMessage,
  useWriteContract,
} from "wagmi";

import { EvidenceInput } from "@/components/passport/evidence-input";
import { MetadataDiffPanel } from "@/components/passport/metadata-diff-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/textarea";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { ensureSiweSession } from "@/lib/auth/ensure-siwe-session";
import {
  elevatedAdvisoryPanel,
  elevatedAdvisoryText,
} from "@/lib/design/instrument-classes";
import {
  KarPassportAbi,
  KarProStakingAbi,
} from "@/lib/contracts/abis.generated";
import type { PassportMetadata } from "@/lib/passport/fetch-arweave-metadata";
import { usePassportOnChainOwner } from "@/hooks/use-passport-on-chain-owner";
import {
  isOnChainNftOwner,
  isPassportHolder,
  resolveEffectiveOnChainOwner,
} from "@/lib/passport/passport-owner";
import {
  OWNER_SERVICE_RECORD_TYPES,
  type OwnerServiceRecordType,
} from "@/lib/passport/record-types";
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
import { useReadContracts } from "wagmi";

type Props = {
  tokenId: string;
  chainId: number;
  passportOwner: `0x${string}`;
  status: PassportStatus;
  lastDisputer: string;
  disputeWithdrawnAt: string;
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
  passportOwner,
  status,
  lastDisputer,
  disputeWithdrawnAt,
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
  const { address, isConnected, connector } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync, isPending } = useWriteContract();
  const { runTx, phase, error, syncLagged } = useTxSync(chainId);
  const [disputeReason, setDisputeReason] = useState("");
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
  const [recordAddedSuccess, setRecordAddedSuccess] = useState(false);

  const passport = karPassportAddress(chainId);
  const staking = karProStakingAddress(chainId);
  const wc = wagmiChainId(chainId);
  const tid = BigInt(tokenId);

  const { data: reads } = useReadContracts({
    contracts:
      passport && staking && address
        ? [
            {
              address: staking,
              abi: KarProStakingAbi,
              functionName: "isActiveVerifier",
              args: [address],
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

  const isActiveVerifier = reads?.[0]?.result === true;
  const isOwner = isOnChainNftOwner(address, effectiveOwner);
  const holder = isPassportHolder({
    address,
    onChainOwner,
    ponderOwner: passportOwner,
    listingActive,
    listingSeller,
  });
  const isLastDisputer =
    Boolean(address) &&
    lastDisputer &&
    address!.toLowerCase() === lastDisputer.toLowerCase();
  const disputeWithdrawn =
    disputeWithdrawnAt !== "0" && Number.parseInt(disputeWithdrawnAt, 10) > 0;

  useEffect(() => {
    if (!recordAddedSuccess) return;
    const timer = window.setTimeout(() => setRecordAddedSuccess(false), 2000);
    return () => window.clearTimeout(timer);
  }, [recordAddedSuccess]);

  const run = useCallback(
    async (fn: () => Promise<`0x${string}`>, success: string) => {
      if (!passport) return;
      if (await runTx(fn)) setMessage(success);
    },
    [passport, runTx],
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
      setRecordAddedSuccess(true);
    }
  }, [
    passport,
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
      disputeReason.trim() ||
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

      {disputeWithdrawn && status === "DISPUTED" && (
        <p className="rounded-md border border-border-default bg-bg-primary/80 p-3 text-sm text-text-secondary">
          Dispute withdrawn (signal only — status remains DISPUTED until verifier resolves).
        </p>
      )}

      {isOwner && status !== "DISPUTED" && !listingActive && (
        <Button asChild variant="secondary" className="w-full">
          <Link href={`/passport/${tokenId}/edit?chain=${chainId}`}>Edit metadata</Link>
        </Button>
      )}

      {isOwner && status === "VERIFIED" && !listingActive && (
        <p className="text-xs text-text-secondary">
          Editing anchor fields while verified will reset verification status.
        </p>
      )}

      {isActiveVerifier && !isOwner && status === "UNVERIFIED" && (
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

      {isConnected && status === "VERIFIED" && (
        <div className="space-y-2">
          <Label htmlFor="dispute-reason">Dispute reason</Label>
          <Textarea
            id="dispute-reason"
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            rows={3}
          />
          {disputeDepositLoading ? (
            <p className="text-xs text-text-secondary">Loading deposit requirement…</p>
          ) : disputeDeposit != null ? (
            <p className="text-xs text-text-secondary">
              Opening a dispute requires a refundable deposit of {formatEther(disputeDeposit)}{" "}
              ETH.
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="w-full border-status-error text-status-error"
            disabled={
              actionsBusy ||
              disputeDepositLoading ||
              disputeDeposit === undefined ||
              !disputeReason.trim()
            }
            onClick={() =>
              void run(
                () =>
                  writeContractAsync({
                    address: passport,
                    abi: KarPassportAbi,
                    functionName: "disputePassport",
                    args: [tid, disputeReason.trim()],
                    value: disputeDeposit,
                    chainId: wc,
                  }),
                "Dispute opened.",
              )
            }
          >
            Open dispute
          </Button>
        </div>
      )}

      {status === "DISPUTED" && isActiveVerifier && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-text-secondary">
            You cannot resolve a dispute you opened yourself.
          </p>
          {!isLastDisputer && (
            <>
              <div className="space-y-2 rounded-md border border-border-default bg-bg-primary/80 p-3">
                <p className="text-xs text-text-secondary">
                  The verification was incorrect. Status becomes unverified. The dispute opener
                  receives the deposit back.
                </p>
                <Button
                  type="button"
                  disabled={actionsBusy}
                  onClick={() =>
                    void run(
                      () =>
                        writeContractAsync({
                          address: passport,
                          abi: KarPassportAbi,
                          functionName: "resolveDispute",
                          args: [tid, 0],
                          chainId: wc,
                        }),
                      "Dispute confirmed. Passport is now unverified.",
                    )
                  }
                >
                  Confirm dispute
                </Button>
              </div>
              <div className="space-y-2 rounded-md border border-border-default bg-bg-primary/80 p-3">
                <p className="text-xs text-text-secondary">
                  The verification stands. Status stays verified. You receive the deposit as
                  compensation for reviewing.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={actionsBusy}
                  onClick={() =>
                    void run(
                      () =>
                        writeContractAsync({
                          address: passport,
                          abi: KarPassportAbi,
                          functionName: "resolveDispute",
                          args: [tid, 1],
                          chainId: wc,
                        }),
                      "Dispute rejected. Verification stands.",
                    )
                  }
                >
                  Reject dispute
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {status === "DISPUTED" && isLastDisputer && (
        <div className="space-y-2">
          {disputeDeposit != null && (
            <p className="text-xs text-text-secondary">
              This restores VERIFIED status and refunds your {formatEther(disputeDeposit)} ETH
              deposit in full. Only you can do this.
            </p>
          )}
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={actionsBusy}
            onClick={() =>
              void run(
                () =>
                  writeContractAsync({
                    address: passport,
                    abi: KarPassportAbi,
                    functionName: "withdrawDispute",
                    args: [tid],
                    chainId: wc,
                  }),
                "Dispute withdrawn. Your deposit has been refunded.",
              )
            }
          >
            Withdraw my dispute
          </Button>
        </div>
      )}

      {status === "DISPUTED" && isOwner && !listingActive && (
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

      {listingActive && holder && (
        <p className="text-xs text-text-secondary">
          Service records can be added after delisting.
        </p>
      )}

      {isOwner && status !== "DISPUTED" && !listingActive && (
        <div className="space-y-2 border-t border-border-default pt-4">
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start px-0 hover:bg-transparent"
            onClick={() => {
              if (!recordAddedSuccess) {
                setRecordFormOpen((open) => !open);
              }
            }}
          >
            {recordAddedSuccess ? "Record added ✓" : "Add record +"}
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

      {isActiveVerifier && !isOwner && (
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

      {isConnected && !holder && (
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
