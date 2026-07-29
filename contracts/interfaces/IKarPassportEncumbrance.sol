// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IKarPassportEncumbrance
 * @notice Closed intent vocabulary for passport permission questions (§9 E0).
 *
 * @dev Callers name an Intent; the passport answers permission (readiness + obligations).
 *      Adding an intent is a deliberate protocol change to this one type.
 */
interface IKarPassportEncumbrance {
    enum Intent {
        LeaveChain,
        OpenConsignment
    }

    /// @notice Permission for `intent`: readiness combined with absence of forbidding obligations (§9).
    function may(uint256 tokenId, Intent intent) external view returns (bool);
}
