// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IEncumbranceRegistry
 * @notice Live encumbrance-source membership on the passport (E4).
 *
 * @dev Modes read this at open so an unregistered mode cannot open while LeaveChain
 *      would be blind to its live consignments. Registration can be revoked — always
 *      read live, never cache.
 */
interface IEncumbranceRegistry {
    function isEncumbranceSource(address source) external view returns (bool);
}
