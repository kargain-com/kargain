// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import {IKarPassportEncumbrance} from "../interfaces/IKarPassportEncumbrance.sol";

/**
 * @title MockPassportEncumbrance
 * @notice ERC-721 + Intent.may stub for FixedPriceConsignment tests (live KarPassport has no may yet).
 */
contract MockPassportEncumbrance is ERC721, IKarPassportEncumbrance {
    mapping(uint256 tokenId => mapping(Intent intent => bool)) public mayPermit;

    constructor() ERC721("MockPassport", "MKP") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function setMay(uint256 tokenId, Intent intent, bool allowed) external {
        mayPermit[tokenId][intent] = allowed;
    }

    function may(uint256 tokenId, Intent intent) external view override returns (bool) {
        return mayPermit[tokenId][intent];
    }
}
