// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FixedPriceConsignment} from "../FixedPriceConsignment.sol";

/**
 * @title FixedPriceConsignmentHarness
 * @notice Test-only floor-slot poison for proving external confirm ignores floor (R4).
 * @dev Deploy behind ERC1967Proxy and call `initialize` (same as production). Parent disables initializers.
 */
contract FixedPriceConsignmentHarness is FixedPriceConsignment {
    /// @dev Test-only: write unused floor slot on a *direct* live consignment.
    function forceSetConsignmentFloor(uint256 tokenId, uint128 floor_) external {
        require(isLiveConsignment(tokenId), "not live");
        require(_consignments[tokenId].agent == address(0), "not direct");
        _consignments[tokenId].floor = floor_;
    }

    /// @dev Test-only: rewrite live storage fee after open to prove splits use the open-time snapshot.
    function forceSetPlatformFeeBps(uint16 feeBps_) external {
        platformFeeBps = feeBps_;
    }

    /// @dev Test-only: clear payment-token feed after open to prove quote refuses parity (P4).
    function forceSetPaymentTokenFeed(address token, address feed) external {
        paymentTokens[token].feed = feed;
    }
}
