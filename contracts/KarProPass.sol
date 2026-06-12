// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title KarProPass
/// @notice Soulbound Kar Pro credential — one token per address.
/// @dev Phase 1: owner issues manually. Phase 2: staking contract mints/burns.
contract KarProPass is ERC721, Ownable {
    address public staking;

    mapping(uint256 => string) public holderCategory;
    mapping(uint256 => string) public holderName;
    mapping(uint256 => uint256) public issuedAt;

    error OnlyStaking();
    error AlreadyHoldsPass();
    error DoesNotHoldPass();
    error Soulbound();

    constructor(address initialOwner) ERC721("KarProPass", "KPP") Ownable(initialOwner) {
        staking = address(0);
    }

    /// @notice Set the staking contract authorized to mint/burn (Phase 2).
    function setStaking(address s) external onlyOwner {
        staking = s;
    }

    /// @notice Founder manually issues a KarProPass (Phase 1).
    function ownerMint(address to, string calldata category, string calldata name) external onlyOwner {
        _mintPass(to, category, name);
    }

    /// @notice Founder manually revokes a KarProPass (Phase 1).
    function ownerBurn(address holder) external onlyOwner {
        _burnPass(holder);
    }

    /// @notice Staking contract issues a KarProPass (Phase 2).
    function mint(address to, string calldata category, string calldata name) external {
        if (msg.sender != staking) revert OnlyStaking();
        _mintPass(to, category, name);
    }

    /// @notice Staking contract burns a KarProPass on unstake (Phase 2).
    function burn(address holder) external {
        if (msg.sender != staking) revert OnlyStaking();
        _burnPass(holder);
    }

    /// @notice Returns holder metadata for a token id.
    function getProPassData(uint256 tokenId)
        external
        view
        returns (address holder, string memory category, string memory name, uint256 issuedAtTimestamp)
    {
        holder = ownerOf(tokenId);
        return (holder, holderCategory[tokenId], holderName[tokenId], issuedAt[tokenId]);
    }

    /// @inheritdoc ERC721
    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    /// @inheritdoc ERC721
    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    function _mintPass(address to, string calldata category, string calldata name) internal {
        if (balanceOf(to) > 0) revert AlreadyHoldsPass();
        uint256 tokenId = uint256(uint160(to));
        _safeMint(to, tokenId);
        holderCategory[tokenId] = category;
        holderName[tokenId] = name;
        issuedAt[tokenId] = block.timestamp;
    }

    function _burnPass(address holder) internal {
        if (balanceOf(holder) == 0) revert DoesNotHoldPass();
        uint256 tokenId = uint256(uint160(holder));
        _burn(tokenId);
        delete holderCategory[tokenId];
        delete holderName[tokenId];
        delete issuedAt[tokenId];
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0) && to != address(0)) {
            revert Soulbound();
        }
        return super._update(to, tokenId, auth);
    }
}
