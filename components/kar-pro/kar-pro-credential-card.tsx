"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatEther, getAddress } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useAccount,
  useChainId,
  useConfig,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import {
  KarProProfileFields,
  type KarProProfileFieldValues,
} from "@/components/kar-pro/kar-pro-profile-fields";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { KarProPassAbi, KarProStakingAbi } from "@/lib/contracts/abis.generated";
import {
  categoryIndexToLabel,
  parseKarProMetadataJson,
  uploadKarProMetadata,
} from "@/lib/kar-pro/kar-pro-metadata";
import { getWalletUploadProvider } from "@/lib/passport/upload-passport-metadata";
import { arUriToHttp } from "@/lib/storage/ar-gateway";
import {
  karProPassAddress,
  karProStakingAddress,
} from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID, wagmiChainId } from "@/lib/web3/supported-chains";

type KarProCredentialCardProps = {
  passId?: bigint;
  category: number;
  name: string;
  slug?: string;
  joinedAt: number;
  verificationCount: number;
  metadataURI?: string;
  address: `0x${string}`;
  onUpdated?: () => void;
  onLeft?: () => void;
};

function formatJoinedDate(timestamp: number): string {
  if (!timestamp) return "Unknown";
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatStakeEth(wei: bigint | undefined): string {
  if (wei === undefined) return "0.05";
  const formatted = formatEther(wei);
  const num = Number.parseFloat(formatted);
  return Number.isFinite(num) ? num.toFixed(2) : formatted;
}

async function fetchMetadataFields(
  metadataURI: string | undefined,
): Promise<Pick<KarProProfileFieldValues, "slug" | "description" | "website">> {
  if (!metadataURI?.startsWith("ar://")) {
    return { slug: "", description: "", website: "" };
  }
  try {
    const url = arUriToHttp(metadataURI);
    if (!url) return { slug: "", description: "", website: "" };
    const res = await fetch(url);
    if (!res.ok) return { slug: "", description: "", website: "" };
    const text = await res.text();
    const parsed = parseKarProMetadataJson(text);
    return {
      slug: parsed?.slug ?? "",
      description: parsed?.description ?? "",
      website: parsed?.website ?? "",
    };
  } catch {
    return { slug: "", description: "", website: "" };
  }
}

export function KarProCredentialCard({
  passId,
  category,
  name,
  slug: slugProp,
  joinedAt,
  verificationCount,
  metadataURI,
  address,
  onUpdated,
  onLeft,
}: KarProCredentialCardProps) {
  const chainId = DEFAULT_CHAIN_ID;
  const config = useConfig();
  const { address: connectedAddress, connector } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [editing, setEditing] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [fields, setFields] = useState<KarProProfileFieldValues>({
    categoryIndex: category,
    name,
    slug: slugProp ?? "",
    description: "",
    website: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const staking = karProStakingAddress(chainId);
  const proPass = karProPassAddress(chainId);
  const wc = wagmiChainId(chainId);
  const wrongChain = walletChain !== chainId;

  const resolvedPassId = passId ?? BigInt(getAddress(address));

  const { data: isActiveVerifier } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "isActiveVerifier",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: { enabled: Boolean(staking && connectedAddress) },
  });

  const { data: minStake } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "minStakeNative",
    query: { enabled: Boolean(staking) },
  });

  const stakeLabel = formatStakeEth(minStake);
  const showroomSlug = (slugProp ?? "").trim() || fields.slug.trim();

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    void (async () => {
      const extra = await fetchMetadataFields(metadataURI);
      if (!cancelled) {
        setFields({
          categoryIndex: category,
          name,
          slug: extra.slug || slugProp || "",
          description: extra.description,
          website: extra.website,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editing, category, name, metadataURI, slugProp]);

  const onSaveProfile = async () => {
    if (!proPass || !fields.name.trim() || !fields.slug.trim()) return;
    setError(null);
    setLoading(true);

    try {
      if (wrongChain) await switchChainAsync?.({ chainId: wc });

      const provider = await getWalletUploadProvider(connector ?? undefined);
      const metadataUri = await uploadKarProMetadata(
        {
          categoryIndex: fields.categoryIndex,
          name: fields.name.trim(),
          slug: fields.slug.trim(),
          description: fields.description.trim() || undefined,
          website: fields.website.trim() || undefined,
        },
        provider,
      );

      const hash = await writeContractAsync({
        address: proPass,
        abi: KarProPassAbi,
        functionName: "updateProfile",
        args: [fields.categoryIndex, fields.name.trim(), metadataUri],
      });

      await waitForTransactionReceipt(config, { hash });
      setEditing(false);
      onUpdated?.();
    } catch (err) {
      if (err instanceof Error && err.message.includes("User rejected")) {
        setError("Transaction cancelled.");
      } else {
        setError(err instanceof Error ? err.message : "Update failed. Try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const onLeave = async () => {
    if (!staking) return;
    setError(null);
    setLoading(true);

    try {
      if (wrongChain) await switchChainAsync?.({ chainId: wc });

      const hash = await writeContractAsync({
        address: staking,
        abi: KarProStakingAbi,
        functionName: "leave",
      });

      await waitForTransactionReceipt(config, { hash });
      setLeaveConfirm(false);
      onLeft?.();
    } catch (err) {
      if (err instanceof Error && err.message.includes("User rejected")) {
        setError("Transaction cancelled.");
      } else {
        setError(err instanceof Error ? err.message : "Leave failed. Try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (isActiveVerifier === false) {
    return null;
  }

  return (
    <article className="rounded-md border border-border-default bg-bg-card p-6 md:p-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-accent-warm">
          ✓ KarPro
        </span>
        <span className="font-mono text-xs uppercase tracking-wider text-text-secondary border border-border-default rounded-sm px-2 py-1">
          {categoryIndexToLabel(category)}
        </span>
      </div>

      <h2 className="mt-4 font-sans text-base font-medium tracking-tight leading-snug text-text-primary">
        {name}
      </h2>

      <p className="mt-2 font-mono text-fluid-sm text-text-secondary">
        Pass #{resolvedPassId.toString()} · Joined {formatJoinedDate(joinedAt)}
      </p>

      <p className="mt-1 font-sans text-fluid-sm text-text-secondary">
        {verificationCount} verification{verificationCount === 1 ? "" : "s"}
      </p>

      {editing ? (
        <div className="mt-6 space-y-5">
          <KarProProfileFields
            idPrefix="kar-pro-edit"
            values={fields}
            onChange={setFields}
            disabled={loading}
            ownerAddress={address}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={loading || !fields.name.trim() || !fields.slug.trim()} onClick={() => void onSaveProfile()}>
              {loading ? "Saving…" : "Save profile"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={loading}
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap gap-2">
          <Button type="button" variant="ghost" disabled={loading} onClick={() => setEditing(true)}>
            Update profile
          </Button>
          {showroomSlug && (
            <Button type="button" variant="ghost" asChild>
              <Link href={`/pro/${showroomSlug}`}>View showroom →</Link>
            </Button>
          )}
        </div>
      )}

      <Separator className="my-6" />

      <div className="space-y-3">
        <p className="font-sans text-fluid-sm text-text-secondary">
          Leave KarPro — your stake ({stakeLabel} ETH) will be returned. Your verification history
          remains on-chain permanently.
        </p>

        {leaveConfirm ? (
          <div className="space-y-3 rounded-sm border border-border-default bg-bg-surface p-4">
            <p className="font-sans text-sm text-text-primary">
              This will burn your KarProPass #{resolvedPassId.toString()}. Continue?
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                className="text-status-error hover:bg-bg-surface hover:text-status-error"
                disabled={loading}
                onClick={() => void onLeave()}
              >
                Confirm leave
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={loading}
                onClick={() => {
                  setLeaveConfirm(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="text-status-error hover:bg-bg-surface hover:text-status-error"
            disabled={loading}
            onClick={() => setLeaveConfirm(true)}
          >
            Leave KarPro
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 font-sans text-fluid-sm text-status-error">
          {error}
        </p>
      )}
    </article>
  );
}
