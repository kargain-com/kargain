export const LISTING_CHAIN_STATUS_CONFIRM_IDLE_TIMEOUT_MS = 2000;

export function shouldEnableListingChainStatusConfirm(input: {
  deferReady: boolean;
  hasRows: boolean;
}): boolean {
  return input.deferReady && input.hasRows;
}
