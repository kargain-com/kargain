// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IEncumbranceSource
 * @notice External obligation answers consulted by KarPassport.may (E1/E4).
 * @dev Same Intent vocabulary as IKarPassportEncumbrance. AscendingConsignment
 *      satisfies this shape via its IKarPassportEncumbrance implementation.
 */
interface IEncumbranceSource {
    enum Intent {
        LeaveChain,
        OpenConsignment
    }

    function may(uint256 tokenId, Intent intent) external view returns (bool);
}
