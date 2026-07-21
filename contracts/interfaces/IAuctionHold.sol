// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal AuctionEscrow settlement-hold view for outbound bridge guards (SPEC §I.12.6 / A16).
interface IAuctionHold {
    /// @notice Returns the settlement hold row for `tokenId` (zero `releaseAt` = no active hold).
    function holds(uint256 tokenId)
        external
        view
        returns (
            address buyer,
            uint128 gross,
            uint40 releaseAt,
            uint40 disputedAt,
            uint128 bond,
            uint40 refundPendingAt
        );
}
