"use server";

import {
  fetchPassportDetail,
  type PassportDetailResult,
} from "@/lib/passport/fetch-passport-detail";

export async function getPassportDetail(
  tokenId: string,
  chainId: number,
): Promise<PassportDetailResult> {
  return fetchPassportDetail(tokenId, chainId);
}

/**
 * Uncached passport detail for indexer catch-up polls.
 * Do not use for page/RSC — those use tagged {@link getPassportDetail}.
 */
export async function getPassportDetailLive(
  tokenId: string,
  chainId: number,
): Promise<PassportDetailResult> {
  return fetchPassportDetail(tokenId, chainId, { live: true });
}
