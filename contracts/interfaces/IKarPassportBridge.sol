// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Gateway-facing KarPassport surface (SPEC §I.12.7).
interface IKarPassportBridge {
    function bridgeMint(address to, uint256 tokenId, string calldata uri) external;

    function bridgeBurn(uint256 tokenId) external;

    function setCustodyLock(uint256 tokenId, bool locked) external;

    function bridgeResetOnUnlock(uint256 tokenId, string calldata uri) external;

    function passportStatus(uint256 tokenId) external view returns (uint8);

    function tokenURI(uint256 tokenId) external view returns (string memory);

    function ownerOf(uint256 tokenId) external view returns (address);
}
