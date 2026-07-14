import { searchActiveAuctions } from "@/app/actions/auction-browse";
import { AuctionBrowse } from "@/components/auction/auction-browse";
import { parseChainParam } from "@/lib/web3/parse-chain-param";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function AuctionBrowseLoader({ searchParams }: Props) {
  const sp = await searchParams;
  const chainId = parseChainParam(sp.chain);
  const initialPage = await searchActiveAuctions({ chainId, limit: 48 });
  return <AuctionBrowse initialPage={initialPage} chainId={chainId} />;
}
