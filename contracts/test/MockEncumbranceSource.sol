// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IEncumbranceSource} from "../interfaces/IEncumbranceSource.sol";

/// @dev Test stub: toggle per-intent answers for passport registry proofs.
contract MockEncumbranceSource is IEncumbranceSource {
    bool public allowLeave = true;
    bool public allowOpen = true;

    function setAllow(bool leave, bool open_) external {
        allowLeave = leave;
        allowOpen = open_;
    }

    function may(uint256, Intent intent) external view override returns (bool) {
        if (intent == Intent.LeaveChain) return allowLeave;
        return allowOpen;
    }
}
