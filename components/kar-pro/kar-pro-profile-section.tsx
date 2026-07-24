"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";

import {
  KarProProfileFields,
  type KarProProfileFieldValues,
} from "@/components/kar-pro/kar-pro-profile-fields";
import { Button } from "@/components/ui/button";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { KarProPassAbi } from "@/lib/contracts/abis.generated";
import {
  parseKarProMetadataJson,
  uploadKarProMetadata,
} from "@/lib/kar-pro/kar-pro-metadata";
import { getWalletUploadProvider } from "@/lib/passport/upload-passport-metadata";
import { arUriToHttp } from "@/lib/storage/ar-gateway";
import { karProPassAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type KarProProfileSectionProps = {
  chainId: number;
  category: number;
  name: string;
  slug?: string;
  metadataURI?: string;
  address: `0x${string}`;
  onUpdated?: () => void;
};

async function fetchMetadataFields(
  metadataURI: string | undefined,
): Promise<Pick<KarProProfileFieldValues, "slug" | "description" | "website" | "location">> {
  if (!metadataURI?.startsWith("ar://")) {
    return { slug: "", description: "", website: "", location: null };
  }
  try {
    const url = arUriToHttp(metadataURI);
    if (!url) return { slug: "", description: "", website: "", location: null };
    const res = await fetch(url);
    if (!res.ok) return { slug: "", description: "", website: "", location: null };
    const text = await res.text();
    const parsed = parseKarProMetadataJson(text);
    return {
      slug: parsed?.slug ?? "",
      description: parsed?.description ?? "",
      website: parsed?.website ?? "",
      location: parsed?.location ?? null,
    };
  } catch {
    return { slug: "", description: "", website: "", location: null };
  }
}

export function KarProProfileSection({
  chainId,
  category,
  name,
  slug: slugProp,
  metadataURI,
  address,
  onUpdated,
}: KarProProfileSectionProps) {
  const { connector } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { runTx, phase: txPhase, error: txSyncError, syncLagged } = useTxSync(chainId);
  const wc = wagmiChainId(chainId);

  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<KarProProfileFieldValues>({
    categoryIndex: category,
    name,
    slug: slugProp ?? "",
    description: "",
    website: "",
    location: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proPass = karProPassAddress(chainId);
  const showroomSlug = (slugProp ?? "").trim() || fields.slug.trim();
  const isBusy = loading || txPhase !== "idle";

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
          location: extra.location,
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
      const provider = await getWalletUploadProvider(connector ?? undefined);
      const metadataUri = await uploadKarProMetadata(
        {
          categoryIndex: fields.categoryIndex,
          name: fields.name.trim(),
          slug: fields.slug.trim(),
          description: fields.description.trim() || undefined,
          website: fields.website.trim() || undefined,
          location: fields.location,
        },
        provider,
      );

      setLoading(false);
      const succeeded = await runTx(
        () =>
          writeContractAsync({
            address: proPass,
            abi: KarProPassAbi,
            functionName: "updateProfile",
            args: [fields.categoryIndex, fields.name.trim(), metadataUri],
            chainId: wc,
          }),
        {
          mapError: (err) =>
            err instanceof Error && err.message.includes("User rejected")
              ? "Transaction cancelled."
              : err instanceof Error
                ? err.message
                : "Update failed. Try again.",
        },
      );
      if (succeeded) {
        setEditing(false);
        onUpdated?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-md border border-border-default bg-bg-card p-6 md:p-8">
      {editing ? (
        <div className="space-y-5">
          <KarProProfileFields
            idPrefix="kar-pro-edit"
            values={fields}
            onChange={setFields}
            disabled={isBusy}
            ownerAddress={address}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={isBusy || !fields.name.trim() || !fields.slug.trim()}
              onClick={() => void onSaveProfile()}
            >
              {txPhase === "indexing" ? "Confirming…" : isBusy ? "Saving…" : "Save profile"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={isBusy}
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
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" disabled={isBusy} onClick={() => setEditing(true)}>
            Update profile
          </Button>
          {showroomSlug && (
            <Button type="button" variant="ghost" asChild>
              <Link href={`/pro/${showroomSlug}`}>View showroom →</Link>
            </Button>
          )}
        </div>
      )}

      {(error ?? txSyncError) && (
        <p role="alert" className="mt-4 font-sans text-fluid-sm text-status-error">
          {error ?? txSyncError}
        </p>
      )}
      {syncLagged && (
        <p role="status" className="font-sans text-xs text-text-tertiary">
          {TX_SYNC_LAG_ADVISORY}
        </p>
      )}
    </div>
  );
}
