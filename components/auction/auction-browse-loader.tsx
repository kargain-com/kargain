import { searchActiveAuctions } from "@/app/actions/auction-browse";
import { AuctionBrowse } from "@/components/auction/auction-browse";
import { parseOptionalChainParam } from "@/lib/web3/chain-context";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function AuctionBrowseLoader({ searchParams }: Props) {
  const sp = await searchParams;
  const chainId = parseOptionalChainParam(sp.chain);
  const initialPage = await searchActiveAuctions({
    chainId: chainId ?? undefined,
    limit: 48,
  });
  return <AuctionBrowse initialPage={initialPage} chainId={chainId} />;
}
