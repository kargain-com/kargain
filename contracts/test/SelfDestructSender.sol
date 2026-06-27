// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IERC721Approve {
    function setApprovalForAll(address operator, bool approved) external;
}

interface IMarketplaceList {
    function list(uint256 tokenId, uint128 fiatPrice1e8, bytes32 currencyCode) external;
}

/// @notice Test-only helper to force-send ETH to a contract without receive().
contract SelfDestructSender is IERC721Receiver {
    /// @notice Sends `msg.value` to `target` via `selfdestruct`.
    function destroyAndSend(address payable target) external payable {
        selfdestruct(target);
    }

    /// @notice Approves marketplace and lists as contract seller (no ETH receive).
    function approveAndList(
        address passport,
        address marketplace,
        uint256 tokenId,
        uint128 price,
        bytes32 currency
    ) external {
        IERC721Approve(passport).setApprovalForAll(marketplace, true);
        IMarketplaceList(marketplace).list(tokenId, price, currency);
    }

    /// @notice Minimal LayerZero endpoint stub so OApp constructors can call setDelegate.
    function setDelegate(address) external {}

    /// @inheritdoc IERC721Receiver
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
