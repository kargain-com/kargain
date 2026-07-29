// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IEncumbranceSource} from "../interfaces/IEncumbranceSource.sol";

/// @dev E6 shapes: revert / empty returndata / unreadable returndata / gas exhaustion.

contract RevertingEncumbranceSource is IEncumbranceSource {
    function may(uint256, Intent) external pure override returns (bool) {
        revert("source-reverted");
    }
}

/// @dev Succeeds with zero returndata (looks like a non-conforming / empty answer).
contract EmptyReturnEncumbranceSource is IEncumbranceSource {
    function may(uint256, Intent) external pure override returns (bool) {
        assembly {
            return(0, 0)
        }
    }
}

/// @dev Succeeds with 64 bytes of returndata (not a single bool word).
contract UnreadableReturnEncumbranceSource is IEncumbranceSource {
    function may(uint256, Intent) external pure override returns (bool) {
        assembly {
            mstore(0x00, 1)
            mstore(0x20, 1)
            return(0x00, 0x40)
        }
    }
}

/// @dev Burns the caller's gas stipend (infinite loop).
contract GasBurningEncumbranceSource is IEncumbranceSource {
    function may(uint256, Intent) external pure override returns (bool) {
        assembly {
            for {} 1 {} {}
        }
    }
}
