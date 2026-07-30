// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @notice Test-only helper to force-send ETH to a contract without receive().
contract SelfDestructSender is IERC721Receiver {
    /// @notice Sends `msg.value` to `target` via `selfdestruct`.
    function destroyAndSend(address payable target) external payable {
        selfdestruct(target);
    }

    /// @notice Minimal LayerZero endpoint stub so OApp constructors can call setDelegate.
    function setDelegate(address) external {}

    /// @inheritdoc IERC721Receiver
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
