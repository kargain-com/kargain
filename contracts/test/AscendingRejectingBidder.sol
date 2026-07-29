// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAscendingBid {
    function bid(uint256 tokenId, uint128 amount) external payable;
    function withdrawClaim(address asset) external;
}

/**
 * @title AscendingRejectingBidder
 * @notice Contract bidder that rejects ERC-721 receiver hooks and (optionally) native refunds.
 * @dev Settlement uses non-safe transferFrom — this contract still receives the passport (B2).
 */
contract AscendingRejectingBidder {
    IAscendingBid public immutable mode;
    bool public acceptEth;

    constructor(address mode_) {
        mode = IAscendingBid(mode_);
    }

    function setAcceptEth(bool value) external {
        acceptEth = value;
    }

    function bidNative(uint256 tokenId) external payable {
        mode.bid{value: msg.value}(tokenId, uint128(msg.value));
    }

    function withdrawClaim(address asset) external {
        mode.withdrawClaim(asset);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert("AscendingRejectingBidder: refuse NFT callback");
    }

    receive() external payable {
        if (!acceptEth) revert("AscendingRejectingBidder: no receive");
    }
}
