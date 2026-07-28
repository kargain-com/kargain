// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Erc20Admission
/// @notice Prove an address is a codeful ERC-20 that conforms to the transfer return convention before
///         it may enter the protocol. Payout paths then treat transfer failure as an unambiguous claim credit.
library Erc20Admission {
    error TokenHasNoCode();
    error TokenNonConforming();
    error TokenDecimalsUnavailable();

    /// @dev Requires `token.code.length > 0` and that `transfer(this, 0)` succeeds with empty returndata
    ///      or a 32-byte `true`. Rejects EOAs and tokens that return non-standard shapes or revert on zero transfer.
    function requireConforming(address token) internal {
        if (token.code.length == 0) revert TokenHasNoCode();

        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), address(this), uint256(0))
        );
        if (!success) revert TokenNonConforming();
        if (data.length == 0) return;
        if (data.length == 32 && abi.decode(data, (bool))) return;
        revert TokenNonConforming();
    }

    /// @dev Staticcalls `decimals()`; requires success and exactly 32 bytes of returndata.
    function requireDecimals(address token) internal view returns (uint8) {
        (bool success, bytes memory data) = token.staticcall(abi.encodeWithSelector(bytes4(keccak256("decimals()"))));
        if (!success || data.length != 32) revert TokenDecimalsUnavailable();
        return abi.decode(data, (uint8));
    }
}
