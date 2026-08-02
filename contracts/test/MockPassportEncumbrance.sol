// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import {IEncumbranceRegistry} from "../interfaces/IEncumbranceRegistry.sol";
import {IKarPassportEncumbrance} from "../interfaces/IKarPassportEncumbrance.sol";

/**
 * @title MockPassportEncumbrance
 * @notice ERC-721 + Intent.may stub + encumbrance registry for mode tests.
 *
 * @dev `isEncumbranceSource` defaults to true so existing open suites stay green;
 *      registration-gate tests call `setEncumbranceSource(mode, false)`.
 */
contract MockPassportEncumbrance is ERC721, IKarPassportEncumbrance, IEncumbranceRegistry {
    mapping(uint256 tokenId => mapping(Intent intent => bool)) public mayPermit;
    /// @dev KarPassport.Status ordinal; mint defaults to VERIFIED so ascending open suites stay green.
    mapping(uint256 tokenId => uint8) public passportStatus;
    mapping(address source => bool) internal _sourceSet;
    mapping(address source => bool) internal _sourceRegistered;
    bool public defaultEncumbranceSource = true;

    constructor() ERC721("MockPassport", "MKP") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
        passportStatus[tokenId] = 1; // VERIFIED
    }

    function setPassportStatus(uint256 tokenId, uint8 status) external {
        passportStatus[tokenId] = status;
    }

    function setMay(uint256 tokenId, Intent intent, bool allowed) external {
        mayPermit[tokenId][intent] = allowed;
    }

    function may(uint256 tokenId, Intent intent) external view override returns (bool) {
        return mayPermit[tokenId][intent];
    }

    function setDefaultEncumbranceSource(bool registered) external {
        defaultEncumbranceSource = registered;
    }

    function setEncumbranceSource(address source, bool registered) external {
        _sourceSet[source] = true;
        _sourceRegistered[source] = registered;
    }

    function isEncumbranceSource(address source) external view override returns (bool) {
        if (_sourceSet[source]) return _sourceRegistered[source];
        return defaultEncumbranceSource;
    }
}
