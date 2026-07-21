// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Test-only AuctionEscrow.holds stand-in for InSettlementHold guard tests.
contract MockAuctionHold {
    mapping(uint256 => uint40) private _releaseAt;

    function setReleaseAt(uint256 tokenId, uint40 releaseAt) external {
        _releaseAt[tokenId] = releaseAt;
    }

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
        )
    {
        return (address(0), 0, _releaseAt[tokenId], 0, 0, 0);
    }
}
