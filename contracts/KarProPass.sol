// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title KarProPass
/// @notice Immutable soulbound Kar Pro credential — one token per address, minted/burned only by KarProStaking.
contract KarProPass is ERC721, Ownable {
    enum Category {
        MECHANIC,
        GARAGE,
        INSPECTOR,
        BROKER,
        DEALER,
        OTHER
    }

    address public staking;

    mapping(uint256 => Category) public holderCategory;
    mapping(uint256 => string) public holderName;
    mapping(uint256 => string) public holderMetadataURI;
    mapping(uint256 => uint256) public issuedAt;

    error OnlyStaking();
    error AlreadyHoldsPass();
    error DoesNotHoldPass();
    error Soulbound();
    error NotHolder();

    event ProPassMinted(address indexed holder, uint8 category, string name);
    event ProPassBurned(address indexed holder);
    event ProfileUpdated(address indexed holder, uint8 category, string name);

    /// @notice Deploys the soulbound Kar Pro pass collection.
    /// @param initialOwner Owner allowed to set the staking contract address.
    constructor(address initialOwner) ERC721("KarProPass", "KPP") Ownable(initialOwner) {
        staking = address(0);
    }

    /// @notice Sets the staking contract authorized to mint and burn passes.
    /// @param s KarProStaking contract address.
    function setStaking(address s) external onlyOwner {
        staking = s;
    }

    /// @notice Mints a KarProPass for a verifier (callable only by KarProStaking).
    /// @param to Recipient address; token id is `uint256(uint160(to))`.
    /// @param category Verifier category enum value.
    /// @param name Public verifier display name.
    /// @param metadataURI Off-chain profile metadata URI.
    function mint(address to, uint8 category, string calldata name, string calldata metadataURI) external {
        if (msg.sender != staking) revert OnlyStaking();
        if (balanceOf(to) > 0) revert AlreadyHoldsPass();

        uint256 tokenId = uint256(uint160(to));
        holderCategory[tokenId] = Category(category);
        holderName[tokenId] = name;
        holderMetadataURI[tokenId] = metadataURI;
        issuedAt[tokenId] = block.timestamp;
        _safeMint(to, tokenId);

        emit ProPassMinted(to, category, name);
    }

    /// @notice Burns a KarProPass when a verifier leaves (callable only by KarProStaking).
    /// @param holder Address holding the pass to burn.
    function burn(address holder) external {
        if (msg.sender != staking) revert OnlyStaking();
        if (balanceOf(holder) == 0) revert DoesNotHoldPass();

        uint256 tokenId = uint256(uint160(holder));
        _burn(tokenId);
        delete holderCategory[tokenId];
        delete holderName[tokenId];
        delete holderMetadataURI[tokenId];
        delete issuedAt[tokenId];

        emit ProPassBurned(holder);
    }

    /// @notice Updates the holder's public profile metadata.
    /// @param category New verifier category enum value.
    /// @param name New public display name.
    /// @param metadataURI New off-chain profile metadata URI.
    function updateProfile(uint8 category, string calldata name, string calldata metadataURI) external {
        uint256 tokenId = uint256(uint160(msg.sender));
        if (_ownerOf(tokenId) != msg.sender) revert NotHolder();

        holderCategory[tokenId] = Category(category);
        holderName[tokenId] = name;
        holderMetadataURI[tokenId] = metadataURI;

        emit ProfileUpdated(msg.sender, category, name);
    }

    /// @notice Returns on-chain profile data for a pass token.
    /// @param tokenId Pass token id (`uint256(uint160(holder))`).
    /// @return holder Token owner address.
    /// @return category Category enum as uint8.
    /// @return name Public display name.
    /// @return metadataURI Off-chain profile metadata URI.
    /// @return issuedAtTimestamp Unix timestamp when the pass was minted.
    function getProPassData(uint256 tokenId)
        external
        view
        returns (
            address holder,
            uint8 category,
            string memory name,
            string memory metadataURI,
            uint256 issuedAtTimestamp
        )
    {
        holder = ownerOf(tokenId);
        return (
            holder,
            uint8(holderCategory[tokenId]),
            holderName[tokenId],
            holderMetadataURI[tokenId],
            issuedAt[tokenId]
        );
    }

    /// @inheritdoc ERC721
    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    /// @inheritdoc ERC721
    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0) && to != address(0)) {
            revert Soulbound();
        }
        return super._update(to, tokenId, auth);
    }
}
