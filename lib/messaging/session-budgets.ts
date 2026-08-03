/**
 * Wall-clock budgets for messaging session operations.
 * Values are behaviour-preserving — change only with an explicit decision.
 */

/**
 * UI hint deadline on reconciling snapshots that have no hard op deadline
 * (e.g. intent load). Smaller: spinner flips to stale/error before the read
 * finishes on slow relays. Larger: UI keeps “working” chrome after the user
 * would reasonably expect a next action.
 */
export const RECONCILING_HINT_MS = 5_000;

/**
 * Silent local XMTP `build` must settle by this wall time. Smaller: cold WASM /
 * disk restore falsely times out into needs_signature/retry. Larger: a hung
 * build holds reconciling longer before the user can act.
 */
export const BUILD_DEADLINE_MS = 10_000;

/**
 * Minimum gap between full-account installation revokes for one address.
 * Full revoke spends irreversible inbox updates. Smaller: users can burn the
 * 256-update budget faster via repeated Free-all. Larger: a needed second
 * full revoke after a failed recreate stays blocked longer.
 */
export const REVOKE_ALL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
