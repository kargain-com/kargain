// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FixedPriceConsignment} from "../FixedPriceConsignment.sol";

/**
 * @title FixedPriceConsignmentHarness
 * @notice Test-only floor-slot poison for proving external confirm ignores floor (R4).
 */
contract FixedPriceConsignmentHarness is FixedPriceConsignment {
    constructor(
        address passport_,
        address platformRecipient_,
        uint256 feeBps_,
        address nativeUsdFeed_,
        uint256 maxFeedStaleness_,
        address initialOwner_
    )
        FixedPriceConsignment(
            passport_,
            platformRecipient_,
            feeBps_,
            nativeUsdFeed_,
            maxFeedStaleness_,
            initialOwner_
        )
    {}

    /// @dev Test-only: write unused floor slot on a *direct* live consignment.
    function forceSetConsignmentFloor(uint256 tokenId, uint128 floor_) external {
        require(isLiveConsignment(tokenId), "not live");
        require(_consignments[tokenId].agent == address(0), "not direct");
        _consignments[tokenId].floor = floor_;
    }
}
