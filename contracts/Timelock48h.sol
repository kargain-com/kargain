// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Version policy:
//   PATCH (Z): bug fixes that do not change ABI or storage layout
//   MINOR (Y): new functions added, backward compatible
//   MAJOR (X): breaking ABI changes, storage layout changes,
//               or fundamental behavior change
//   Pre-release: -rc.N for release candidates, remove on mainnet deploy
//   Immutable contracts (KarPassport, KarProPass, KarProStaking):
//     any change = new deployment = bump MINOR or MAJOR
//   Upgradeable contracts (FixedPriceConsignment, AscendingConsignment):
//     UUPS upgrade = bump MINOR or MAJOR depending on scope

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title Timelock48h
/// @notice OpenZeppelin TimelockController with a fixed 48-hour minimum delay for Kargain governance.
/// @dev Used as the mode contracts' `upgradeAuthority`. Proposer schedules; executor executes after delay.
/// @custom:version 1.0.0-rc.1
contract Timelock48h is TimelockController {
    string public constant VERSION = "1.0.0-rc.1";

    /// @notice Minimum delay enforced on all scheduled operations (48 hours).
    uint256 public constant MIN_DELAY_SECONDS = 48 hours;

    /// @notice Deploys the timelock with proposer, executor, and optional initial admin roles.
    /// @param proposers Addresses allowed to schedule operations.
    /// @param executors Addresses allowed to execute operations after the delay.
    /// @param admin Admin address (use address(0) to renounce immediately after setup).
    constructor(address[] memory proposers, address[] memory executors, address admin)
        TimelockController(MIN_DELAY_SECONDS, proposers, executors, admin)
    {}
}
