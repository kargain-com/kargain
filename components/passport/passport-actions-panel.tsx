"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import {
  useAccount,
  useChainId,
  useSignMessage,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { EvidenceInput } from "@/components/passport/evidence-input";
import { MetadataDiffPanel } from "@/components/passport/metadata-diff-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { ensureSiweSession } from "@/lib/auth/ensure-siwe-session";
import {
  KarPassportAbi,
  KarProStakingAbi,
} from "@/lib/contracts/abis.generated";
import type { getDetailStrings } from "@/lib/i18n/marketplace-detail-locales";
import type { PassportMetadata } from "@/lib/passport/fetch-arweave-metadata";
import { DISPUTE_WITHDRAWN_PREFIX } from "@/lib/passport/index-passport-metadata";
import {
  getWalletUploadProvider,
} from "@/lib/passport/upload-passport-metadata";
import { uploadEvidenceFile } from "@/lib/passport/upload-evidence";
import type { PassportStatus, PonderUriHistoryEntry } from "@/lib/types/ponder";
import {
  karPassportAddress,
  karProStakingAddress,
  marketplaceAddress,
} from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { useReadContracts } from "wagmi";

type T = ReturnType<typeof getDetailStrings>;

type Props = {
  tokenId: string;
  chainId: number;
  passportOwner: `0x${string}`;
  status: PassportStatus;
  lastDisputer: string;
  disputeWithdrawnAt: string;
  duplicateVin: boolean;
  listingActive?: boolean;
  tokenUri: string;
  currentMetadata: PassportMetadata | null;
  uriHistory: PonderUriHistoryEntry[];
  verificationResetCount: number;
  lastVerificationResetAt: string;
  labels: T;
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
  tokenUri,
  currentMetadata,
  uriHistory,
  verificationResetCount,
  lastVerificationResetAt,
  labels,
}: Props) {
  const router = useRouter();
  const { address, isConnected, connector } = useAccount();
  const walletChain = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const [disputeReason, setDisputeReason] = useState("");
  const [clarificationText, setClarificationText] = useState("");
  const [discrepancyText, setDiscrepancyText] = useState("");
  const [attestationText, setAttestationText] = useState("");
  const [attestationEvidencePaste, setAttestationEvidencePaste] = useState("");
  const [attestationEvidenceFile, setAttestationEvidenceFile] = useState<File | null>(
    null,
  );
  const [isUploadingEvidence, setIsUploadingEvidence] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const passport = karPassportAddress(chainId);
  const staking = karProStakingAddress(chainId);
  const wc = wagmiChainId(chainId);
  const wrongChain = isConnected && walletChain !== chainId;
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
            },
          ]
        : [],
  });

  const isActiveVerifier = reads?.[0]?.result === true;
  const isOwner =
    Boolean(address) &&
    address!.toLowerCase() === passportOwner.toLowerCase();
  const isLastDisputer =
    Boolean(address) &&
    lastDisputer &&
    address!.toLowerCase() === lastDisputer.toLowerCase();
  const disputeWithdrawn =
    disputeWithdrawnAt !== "0" && Number.parseInt(disputeWithdrawnAt, 10) > 0;

  const run = useCallback(
    async (fn: () => Promise<unknown>, success: string) => {
      if (wrongChain) {
        await switchChainAsync?.({ chainId: wc });
      }
      try {
        await fn();
        setMessage(success);
        router.refresh();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Transaction failed.");
      }
    },
    [router, switchChainAsync, wc, wrongChain],
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

  const submitAttestation = useCallback(async () => {
    const description = attestationText.trim();
    if (!description || !passport) return;

    if (wrongChain) {
      await switchChainAsync?.({ chainId: wc });
    }

    try {
      const evidenceCID = await resolveAttestationEvidence();
      await writeContractAsync({
        address: passport,
        abi: KarPassportAbi,
        functionName: "appendAttestation",
        args: [tid, description, evidenceCID],
      });
      setAttestationText("");
      setAttestationEvidencePaste("");
      setAttestationEvidenceFile(null);
      setMessage(labels.attestationSuccess);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Transaction failed.");
    }
  }, [
    attestationText,
    labels.attestationSuccess,
    passport,
    resolveAttestationEvidence,
    router,
    switchChainAsync,
    tid,
    wc,
    wrongChain,
    writeContractAsync,
  ]);

  const actionsBusy = isPending || isUploadingEvidence;

  if (!isConnected) {
    return (
      <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
        <p className="text-sm text-text-secondary">Connect wallet for on-chain actions.</p>
        <WalletLoginButton />
      </div>
    );
  }

  if (!passport) {
    return (
      <p className="text-sm text-text-secondary">Passport contract not configured.</p>
    );
  }

  return (
    <section className="space-y-4 rounded-md border border-border-default bg-bg-surface p-6">
      <h2 className="font-sans text-base font-medium text-text-primary">Actions</h2>

      {duplicateVin && (
        <p className="rounded-md border border-status-error/40 bg-bg-primary/80 p-3 text-sm text-status-error">
          Duplicate VIN detected on-chain. Review metadata carefully before buying or verifying.
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
                  }),
                "Passport verified.",
              )
            }
          >
            Verify passport
          </Button>
        </div>
      )}

      {status === "VERIFIED" && (
        <div className="space-y-2">
          <Label htmlFor="dispute-reason">Dispute reason</Label>
          <Textarea
            id="dispute-reason"
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            rows={3}
          />
          <Button
            type="button"
            variant="outline"
            className="w-full border-status-error text-status-error"
            disabled={isPending || !disputeReason.trim()}
            onClick={() =>
              void run(
                () =>
                  writeContractAsync({
                    address: passport,
                    abi: KarPassportAbi,
                    functionName: "disputePassport",
                    args: [tid, disputeReason.trim()],
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
            Any active verifier may resolve this dispute (matches on-chain rules).
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
                    args: [tid, true],
                  }),
                "Dispute upheld — passport remains verified.",
              )
            }
          >
            Resolve — uphold
          </Button>
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
                    args: [tid, false],
                  }),
                "Dispute rejected — verification cleared.",
              )
            }
          >
            Resolve — reject
          </Button>
        </div>
      )}

      {status === "DISPUTED" && isLastDisputer && !disputeWithdrawn && (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={isPending}
          onClick={() =>
            void run(
              () =>
                writeContractAsync({
                  address: passport,
                  abi: KarPassportAbi,
                  functionName: "reportDiscrepancy",
                  args: [tid, `${DISPUTE_WITHDRAWN_PREFIX} withdrawn`, ""],
                }),
              "Dispute signal withdrawn.",
            )
          }
        >
          Withdraw dispute signal
        </Button>
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
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={isPending || !clarificationText.trim()}
            onClick={() =>
              void run(
                () =>
                  writeContractAsync({
                    address: passport,
                    abi: KarPassportAbi,
                    functionName: "appendRecord",
                    args: [tid, "dispute-clarification", clarificationText.trim(), ""],
                  }),
                "Clarification appended.",
              )
            }
          >
            Append clarification
          </Button>
        </div>
      )}

      {isActiveVerifier && !isOwner && (
        <div className="space-y-2 border-t border-border-default pt-4">
          <Label htmlFor="attestation-text">{labels.attestationLabel}</Label>
          <p className="text-xs text-text-secondary">{labels.attestationHint}</p>
          <Textarea
            id="attestation-text"
            value={attestationText}
            onChange={(e) => setAttestationText(e.target.value)}
            placeholder={labels.attestationPlaceholder}
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
              evidenceLabel: labels.attestationEvidenceLabel,
              evidenceHint: labels.attestationEvidenceHint,
              evidencePlaceholder: labels.attestationEvidencePlaceholder,
              evidenceFileLabel: labels.attestationEvidenceFileLabel,
            }}
          />
          <Button
            type="button"
            className="w-full"
            disabled={actionsBusy || !attestationText.trim()}
            onClick={() => void submitAttestation()}
          >
            {labels.attestationSubmit}
          </Button>
        </div>
      )}

      <div className="space-y-2 border-t border-border-default pt-4">
        <Label htmlFor="discrepancy">Report discrepancy</Label>
        <Textarea
          id="discrepancy"
          value={discrepancyText}
          onChange={(e) => setDiscrepancyText(e.target.value)}
          rows={2}
        />
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={isPending || !discrepancyText.trim()}
          onClick={() =>
            void run(
              () =>
                writeContractAsync({
                  address: passport,
                  abi: KarPassportAbi,
                  functionName: "reportDiscrepancy",
                  args: [tid, discrepancyText.trim(), ""],
                }),
              "Discrepancy reported.",
            )
          }
        >
          Report discrepancy
        </Button>
      </div>

      {isOwner && marketplaceAddress(chainId) && (
        <Button asChild variant="secondary" className="w-full">
          <Link href={`/marketplace/${tokenId}/edit?chain=${chainId}`}>
            Manage listing
          </Link>
        </Button>
      )}

      {message && (
        <p className="text-sm text-text-secondary" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
