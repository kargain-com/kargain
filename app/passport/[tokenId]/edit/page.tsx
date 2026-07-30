import { notFound } from "next/navigation";

import { EditPassportWizard } from "@/components/passport/edit-passport-wizard";
import { fetchPassportDetail } from "@/lib/passport/fetch-passport-detail";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { parsePassportTokenId } from "@/lib/passport/passport-token-id";
import { commerceModeAddresses } from "@/lib/commerce/mode";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { parseOptionalChainParam } from "@/lib/web3/chain-context";
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

  if (!/^\d+$/.test(tokenId)) notFound();

  const fromUrl = parseOptionalChainParam(sp.chain);
  const parsed = parsePassportTokenId(tokenId);
  const hint =
    fromUrl ?? (parsed.isV2Prefixed ? parsed.chainId : null);

  const result = await fetchPassportDetail(tokenId, hint);
  if (!result.ok) notFound();

  const { passport, metadata } = result;
  if (passport.status === "DISPUTED") notFound();

  const chainId = passport.custodyChain;
  const passportAddr = karPassportAddress(chainId);
  const modeCustodians = Object.values(commerceModeAddresses(chainId)).map(
    (address) => address.toLowerCase(),
  );

  if (passportAddr && modeCustodians.length > 0) {
    try {
      const client = getPublicClient(chainId);
      const owner = await client.readContract({
        address: passportAddr,
        abi: KarPassportAbi,
        functionName: "ownerOf",
        args: [BigInt(tokenId)],
      });
      if (modeCustodians.includes(owner.toLowerCase())) {
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
        existingPhotoUris={metadata?.photos ?? []}
      />
    </div>
  );
}
