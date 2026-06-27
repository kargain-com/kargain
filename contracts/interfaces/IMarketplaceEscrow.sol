// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal marketplace surface for cross-contract guards (e.g. ONFT adapter).
interface IMarketplaceEscrow {
    /// @notice Returns whether `tokenId` has an active escrow listing.
    function isListed(uint256 tokenId) external view returns (bool);
}
