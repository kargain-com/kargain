// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title AscendingTypes
 * @notice Shared lot/hold layouts for AscendingConsignment and its linked libraries.
 * @dev Layout must stay identical across callers — storage refs cross the DELEGATECALL boundary.
 */
library AscendingTypes {
    /// @dev Slot 0: five uint40 + uint16 (216 bits). Slot 1: highestBidder. Slot 2: highestBid.
    struct AuctionTerms {
        uint40 duration;
        uint40 endsAt;
        uint40 extensionWindow;
        uint40 protectionWindow;
        uint40 abandonmentWindow;
        uint16 minIncrementBps;
        address highestBidder;
        uint128 highestBid;
    }

    struct Hold {
        address buyer;
        uint128 gross;
        uint64 protectionEndsAt;
        /// @dev Non-zero while a settlement challenge is open: remaining protection seconds frozen at open.
        uint64 frozenRemaining;
        bool reversalPending;
        uint64 abandonmentDeadline;
        /// @dev Copied from AuctionTerms at settle (auction storage is deleted before uphold).
        uint40 abandonmentWindow;
    }
}
