/**
 * Owner Sell entry copy — sole strings for passport-sell-panel CTAs.
 * Visibility stays in sell-surface.ts; may-refusal copy stays in
 * encumbrance-permission.ts; auction verification hint stays in sale-form-copy.
 */

export const SELL_HEADING = "Sell";

/** Bridge-matched body under the heading. */
export const SELL_DESCRIPTION =
  "List at a fixed price yourself, hire a KarPro, or run a reserve auction when the passport is verified.";

/** Fixed-price open — owner lists themselves. */
export const SELL_LIST = "List";

/** Fixed-price grant — hire a KarPro for fixed-price. */
export const SELL_DELEGATE = "Delegate";

/**
 * Ascending grant (private owner) or dimmed KarPro self-open when blocked.
 * Distinct from create-panel submit "Start auction" when self-open is available.
 */
export const SELL_AUCTION = "Auction";

/** Private-owner note when Auction grant is the path. */
export const SELL_AUCTION_RUNNER_NOTE =
  "Auctions are opened by an active KarPro. Use Auction to let a pro run the lot for you.";
