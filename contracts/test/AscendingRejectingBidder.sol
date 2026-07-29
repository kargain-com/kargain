// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAscendingMode {
    function bid(uint256 tokenId, uint128 amount) external payable;
    function withdrawClaim(address asset) external;
    function open(uint256 subjectId) external payable;
    function withdraw(uint256 subjectId) external;
    function completeReversal(uint256 tokenId) external;
}

interface IERC721Approve {
    function setApprovalForAll(address operator, bool approved) external;
    function approve(address to, uint256 tokenId) external;
}

/**
 * @title AscendingRejectingBidder
 * @notice Contract bidder that rejects ERC-721 receiver hooks and (optionally) native refunds.
 * @dev Settlement uses non-safe transferFrom — this contract still receives the passport (B2).
 *      Helpers let the contract act as challenger / reversal buyer in local E2E claim gates.
 */
contract AscendingRejectingBidder {
    IAscendingMode public immutable mode;
    bool public acceptEth;

    constructor(address mode_) {
        mode = IAscendingMode(mode_);
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

    function openChallenge(uint256 subjectId) external payable {
        mode.open{value: msg.value}(subjectId);
    }

    function withdrawChallenge(uint256 subjectId) external {
        mode.withdraw(subjectId);
    }

    function completeReversal(uint256 tokenId) external {
        mode.completeReversal(tokenId);
    }

    function approvePassport(address passport, address operator, bool approved) external {
        IERC721Approve(passport).setApprovalForAll(operator, approved);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert("AscendingRejectingBidder: refuse NFT callback");
    }

    receive() external payable {
        if (!acceptEth) revert("AscendingRejectingBidder: no receive");
    }
}
