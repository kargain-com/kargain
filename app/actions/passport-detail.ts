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
