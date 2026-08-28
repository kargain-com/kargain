// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Contract-account sink for ClaimablePayouts native-push tests.
/// @dev Low `gasToBurn` completes within `NATIVE_PUSH_GAS` (30_000). Values above
///      `_FAIL_THRESHOLD` make the stipended push fail and credit a claim.
contract GasBoundedRecipient {
    /// @dev Below ClaimablePayouts.NATIVE_PUSH_GAS — leaves headroom for call overhead.
    uint256 internal constant _FAIL_THRESHOLD = 25_000;

    uint256 public gasToBurn;

    function setGasToBurn(uint256 value) external {
        gasToBurn = value;
    }

    receive() external payable {
        if (gasToBurn == 0) return;
        if (gasToBurn > _FAIL_THRESHOLD) {
            assembly {
                invalid()
            }
        }
        uint256 target = gasleft() - gasToBurn;
        while (gasleft() > target && gasleft() > 2_100) {
            // spin — non-trivial receive path
        }
    }
}
