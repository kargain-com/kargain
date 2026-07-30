// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AscendingTypes} from "./AscendingTypes.sol";

/**
 * @title AscendingOpenLib
 * @notice Open-time auction term snapshot and open-parameter bounds checks.
 * @dev Linked into AscendingConsignment via DELEGATECALL — mutates the mode's own storage.
 */
library AscendingOpenLib {
    error BadReserve();
    error BadDuration();
    error ProtectionOutOfBounds();
    error PaymentTokenNotSupported();
    error BadConfig();

    event AscendingTermsSnapshotted(
        uint256 indexed tokenId,
        uint40 duration,
        uint40 extensionWindow,
        uint40 protectionWindow,
        uint40 abandonmentWindow,
        uint16 minIncrementBps,
        uint128 reserve
    );

    /// @dev Bound checks for open; paymentEnabled already resolved by caller.
    function requireAuctionOpenParams(
        uint128 reserve,
        uint40 duration,
        uint40 protectionWindow_,
        address asset,
        uint40 minDuration_,
        uint40 maxDuration_,
        uint40 minProtectionWindow_,
        uint40 maxProtectionWindow_,
        bool paymentTokenEnabled_
    ) external pure {
        if (reserve == 0) revert BadReserve();
        if (duration < minDuration_ || duration > maxDuration_) revert BadDuration();
        if (protectionWindow_ < minProtectionWindow_ || protectionWindow_ > maxProtectionWindow_) {
            revert ProtectionOutOfBounds();
        }
        if (asset != address(0) && !paymentTokenEnabled_) revert PaymentTokenNotSupported();
    }

    function writeAuctionTerms(
        mapping(uint256 => AscendingTypes.AuctionTerms) storage auctions,
        uint256 tokenId,
        uint40 duration,
        uint40 protectionWindow_,
        uint40 extensionWindow_,
        uint40 abandonmentWindow_,
        uint16 minIncrementBps_,
        uint128 reserve
    ) external {
        auctions[tokenId] = AscendingTypes.AuctionTerms({
            duration: duration,
            endsAt: 0,
            extensionWindow: extensionWindow_,
            protectionWindow: protectionWindow_,
            abandonmentWindow: abandonmentWindow_,
            minIncrementBps: minIncrementBps_,
            highestBidder: address(0),
            highestBid: 0
        });
        emit AscendingTermsSnapshotted(
            tokenId,
            duration,
            extensionWindow_,
            protectionWindow_,
            abandonmentWindow_,
            minIncrementBps_,
            reserve
        );
    }

    /// @notice Validate and emit AuctionRulesSet — caller writes storage.
    function requireAuctionRules(
        uint40 minDuration_,
        uint40 maxDuration_,
        uint40 extensionWindow_,
        uint16 minIncrementBps_,
        uint40 minProtectionWindow_,
        uint40 maxProtectionWindow_,
        uint40 abandonmentWindow_,
        uint256 challengeBond_,
        uint256 bps
    ) external pure {
        if (minDuration_ == 0 || maxDuration_ < minDuration_) revert BadConfig();
        if (extensionWindow_ == 0 || abandonmentWindow_ == 0) revert BadConfig();
        if (minProtectionWindow_ == 0 || maxProtectionWindow_ < minProtectionWindow_) revert BadConfig();
        if (minIncrementBps_ == 0 || minIncrementBps_ > bps) revert BadConfig();
        if (challengeBond_ == 0) revert BadConfig();
    }
}
