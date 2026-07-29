// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AscendingConsignment} from "../AscendingConsignment.sol";

/**
 * @title AscendingConsignmentHarness
 * @notice Test-only live-fee poison for proving open-time platformFeeBps snapshot (G1).
 * @dev Deploy behind ERC1967Proxy and call `initialize` (same as production). Parent disables initializers.
 */
contract AscendingConsignmentHarness is AscendingConsignment {
    /// @dev Test-only: rewrite live storage fee after open to prove splits use the open-time snapshot.
    function forceSetPlatformFeeBps(uint16 feeBps_) external {
        platformFeeBps = feeBps_;
    }
}
