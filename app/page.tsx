import { MarketBrowse } from "@/components/marketplace/market-browse";
import { parseChainParam } from "@/lib/web3/parse-chain-param";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ chain?: string | string[] }>;
}) {
  const sp = await searchParams;
  const initialChainId = parseChainParam(sp.chain);
  return <MarketBrowse initialChainId={initialChainId} />;
}
