// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAuctionEscrow} from "../interfaces/IAuctionEscrow.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @notice Contract bidder that reverts on native receive — tests WETH refund fallback.
contract RevertingBidder {
    IAuctionEscrow public immutable escrow;

    constructor(IAuctionEscrow escrow_) {
        escrow = escrow_;
    }

    /// @notice Place a native bid through the escrow.
    function bidNative(uint256 tokenId) external payable {
        escrow.bid{value: msg.value}(tokenId, uint128(msg.value));
    }

    receive() external payable {
        revert("RevertingBidder: no receive");
    }
}

/// @notice Recipient that reverts on native receive — tests payout WETH fallback.
contract RevertingRecipient {
    receive() external payable {
        revert("RevertingRecipient: no receive");
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return bytes4(0x150b7a02);
    }

    /// @notice Owner-only helper: approve escrow and authorize agent (msg.sender to escrow = this contract).
    function authorizeAgentForSelf(
        address passport,
        address escrow,
        uint256 tokenId,
        address agent,
        address asset
    ) external {
        IERC721(passport).setApprovalForAll(escrow, true);
        IAuctionEscrow(escrow).authorizeAuctionAgent(tokenId, agent, 0, asset, 0);
    }
}

/// @notice Malicious bidder that attempts reentrancy during outbid refund.
contract ReentrantBidder {
    IAuctionEscrow public immutable escrow;
    uint256 public targetTokenId;
    uint128 public nextAmount;
    bool public reentering;

    constructor(IAuctionEscrow escrow_) {
        escrow = escrow_;
    }

    function configure(uint256 tokenId, uint128 amount) external {
        targetTokenId = tokenId;
        nextAmount = amount;
    }

    function bidNative(uint256 tokenId, uint128 amount) external payable {
        escrow.bid{value: msg.value}(tokenId, amount);
    }

    receive() external payable {
        if (reentering) return;
        if (nextAmount > 0) {
            reentering = true;
            escrow.bid{value: nextAmount}(targetTokenId, nextAmount);
            reentering = false;
        }
    }
}
