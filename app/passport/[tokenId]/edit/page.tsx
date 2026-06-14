import { notFound } from "next/navigation";

import { EditPassportWizard } from "@/components/passport/edit-passport-wizard";
import { fetchPassportDetail } from "@/lib/passport/fetch-passport-detail";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import {
  karPassportAddress,
  marketplaceAddress,
} from "@/lib/web3/deployment-addresses";
import { parseChainParam } from "@/lib/web3/parse-chain-param";
import { getPublicClient } from "@/lib/web3/public-client";

export default async function EditPassportPage({
  params,
  searchParams,
}: {
  params: Promise<{ tokenId: string }>;
  searchParams: Promise<{ chain?: string | string[] }>;
}) {
  const { tokenId } = await params;
  const sp = await searchParams;
  const chainId = parseChainParam(sp.chain);

  if (!/^\d+$/.test(tokenId)) notFound();

  const result = await fetchPassportDetail(tokenId, chainId);
  if (!result.ok) notFound();

  const { passport, metadata } = result;
  if (passport.status === "DISPUTED") notFound();
  if (!metadata) notFound();

  const passportAddr = karPassportAddress(chainId);
  const market = marketplaceAddress(chainId);

  if (passportAddr && market) {
    try {
      const client = getPublicClient(chainId);
      const owner = await client.readContract({
        address: passportAddr,
        abi: KarPassportAbi,
        functionName: "ownerOf",
        args: [BigInt(tokenId)],
      });
      if (owner.toLowerCase() === market.toLowerCase()) {
        notFound();
      }
    } catch {
      /* allow page; wallet gate on client */
    }
  }

  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <EditPassportWizard
        tokenId={tokenId}
        chainId={chainId}
        status={passport.status}
        initialMetadata={metadata}
        existingPhotoUris={metadata.photos}
      />
    </div>
  );
}
