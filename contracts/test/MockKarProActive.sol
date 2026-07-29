// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Toggleable KarPro admission stub for AscendingConsignment tests (N2).
contract MockKarProActive {
    mapping(address account => bool) public active;

    function setActive(address account, bool value) external {
        active[account] = value;
    }

    function isActiveVerifier(address account) external view returns (bool) {
        return active[account];
    }
}
