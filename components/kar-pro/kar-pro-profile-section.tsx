"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useAccount,
  useChainId,
  useConfig,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import {
  KarProProfileFields,
  type KarProProfileFieldValues,
} from "@/components/kar-pro/kar-pro-profile-fields";
import { Button } from "@/components/ui/button";
import { KarProPassAbi } from "@/lib/contracts/abis.generated";
import {
  parseKarProMetadataJson,
  uploadKarProMetadata,
} from "@/lib/kar-pro/kar-pro-metadata";
import { getWalletUploadProvider } from "@/lib/passport/upload-passport-metadata";
import { arUriToHttp } from "@/lib/storage/ar-gateway";
import { karProPassAddress } from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID, wagmiChainId } from "@/lib/web3/supported-chains";

type KarProProfileSectionProps = {
  category: number;
  name: string;
  slug?: string;
  metadataURI?: string;
  address: `0x${string}`;
  onUpdated?: () => void;
};

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

export function KarProProfileSection({
  category,
  name,
  slug: slugProp,
  metadataURI,
  address,
  onUpdated,
}: KarProProfileSectionProps) {
  const chainId = DEFAULT_CHAIN_ID;
  const config = useConfig();
  const { connector } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<KarProProfileFieldValues>({
    categoryIndex: category,
    name,
    slug: slugProp ?? "",
    description: "",
    website: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proPass = karProPassAddress(chainId);
  const wc = wagmiChainId(chainId);
  const wrongChain = walletChain !== chainId;
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

  return (
    <div className="rounded-md border border-border-default bg-bg-card p-6 md:p-8">
      {editing ? (
        <div className="space-y-5">
          <KarProProfileFields
            idPrefix="kar-pro-edit"
            values={fields}
            onChange={setFields}
            disabled={loading}
            ownerAddress={address}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={loading || !fields.name.trim() || !fields.slug.trim()}
              onClick={() => void onSaveProfile()}
            >
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
        <div className="flex flex-wrap gap-2">
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

      {error && (
        <p role="alert" className="mt-4 font-sans text-fluid-sm text-status-error">
          {error}
        </p>
      )}
    </div>
  );
}
