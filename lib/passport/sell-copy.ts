/**
 * Owner Sell entry copy — sole strings for passport-sell-panel CTAs and group
 * labels. Visibility stays in sell-surface.ts; may-refusal copy stays in
 * encumbrance-permission.ts; auction verification hint stays in sale-form-copy.
 */

export const SELL_HEADING = "Sell";

/** Quiet mode line above fixed-price List / Delegate (or mandate card). */
export const SELL_FIXED_PRICE_GROUP = "Fixed price";

/** Quiet mode line above Auction grant / create panel / runner note. */
export const SELL_AUCTION_GROUP = "Auction";

/** Fixed-price open — owner lists themselves. */
export const SELL_LIST = "List";

/** Fixed-price grant — hire a KarPro for fixed-price. */
export const SELL_DELEGATE = "Delegate";

/**
 * Ascending grant — hire a KarPro to run a reserve auction (private owners only).
 * Distinct from create-panel submit "Start auction" (KarPro self-open).
 */
export const SELL_AUCTION = "Auction";

/** Private-owner note under the Auction group when grant is the path. */
export const SELL_AUCTION_RUNNER_NOTE =
  "Auctions are opened by an active KarPro. Use Auction to let a pro run the lot for you.";
