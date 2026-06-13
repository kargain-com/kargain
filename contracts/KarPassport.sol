// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IKarProStaking {
    function isActiveVerifier(address a) external view returns (bool);
}

/// @title KarPassport
/// @notice ERC-721 vehicle passport with on-chain verification lifecycle and append-only records.
/// @dev Immutable contract; KarProPass holders verify and resolve disputes.
contract KarPassport is ERC721URIStorage, ReentrancyGuard {
    enum Status {
        UNVERIFIED,
        VERIFIED,
        DISPUTED
    }

    struct PassportRecord {
        uint256 timestamp;
        address author;
        string recordType;
        string description;
        string evidenceCID;
    }

    address public immutable karProStakingAddress;

    uint256 private _nextTokenId;

    mapping(uint256 => Status) public passportStatus;
    mapping(uint256 => address) public passportVerifier;
    mapping(uint256 => uint256) public passportVerifiedAt;
    mapping(uint256 => PassportRecord[]) public records;

    event PassportMinted(address indexed to, uint256 indexed tokenId, string uri);
    event PassportVerified(uint256 indexed tokenId, address indexed verifier);
    event PassportDisputed(uint256 indexed tokenId, address indexed disputer, string reason);
    event DisputeResolved(uint256 indexed tokenId, address indexed resolver, bool uphold);
    event PassportURIUpdated(uint256 indexed tokenId, string newURI, address indexed author);
    event RecordAppended(
        uint256 indexed tokenId,
        address indexed author,
        string recordType,
        string description,
        string evidenceCID
    );

    error NonexistentToken();
    error NotOwner();
    error NotActiveVerifier();
    error CannotSelfVerify();
    error InvalidStatus(Status current);
    error EmptyField(string fieldName);

    constructor(address karProStakingAddress_) ERC721("KarPassport", "KPPT") {
        karProStakingAddress = karProStakingAddress_;
    }

    /// @notice Permissionless mint of a new KarPassport NFT.
    function mintPassport(address to, string calldata uri)
        external
        nonReentrant
        returns (uint256 tokenId)
    {
        tokenId = _nextTokenId++;
        passportStatus[tokenId] = Status.UNVERIFIED;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        emit PassportMinted(to, tokenId, uri);
    }

    /// @notice Owner updates metadata URI while passport is UNVERIFIED.
    function setPassportURI(uint256 tokenId, string calldata newURI) external {
        _requireExists(tokenId);
        if (msg.sender != ownerOf(tokenId)) revert NotOwner();
        Status current = passportStatus[tokenId];
        if (current != Status.UNVERIFIED) revert InvalidStatus(current);
        _setTokenURI(tokenId, newURI);
        emit PassportURIUpdated(tokenId, newURI, msg.sender);
    }

    /// @notice KarProPass holder verifies a passport (not the token owner).
    function verifyPassport(uint256 tokenId) external nonReentrant {
        _requireExists(tokenId);
        if (!IKarProStaking(karProStakingAddress).isActiveVerifier(msg.sender)) revert NotActiveVerifier();
        if (ownerOf(tokenId) == msg.sender) revert CannotSelfVerify();
        Status current = passportStatus[tokenId];
        if (current != Status.UNVERIFIED) revert InvalidStatus(current);
        passportStatus[tokenId] = Status.VERIFIED;
        passportVerifier[tokenId] = msg.sender;
        passportVerifiedAt[tokenId] = block.timestamp;
        emit PassportVerified(tokenId, msg.sender);
    }

    /// @notice Anyone may dispute a VERIFIED passport.
    function disputePassport(uint256 tokenId, string calldata reason) external nonReentrant {
        _requireExists(tokenId);
        Status current = passportStatus[tokenId];
        if (current != Status.VERIFIED) revert InvalidStatus(current);
        if (bytes(reason).length == 0) revert EmptyField("reason");
        passportStatus[tokenId] = Status.DISPUTED;
        _appendRecord(tokenId, "discrepancy", reason, "", msg.sender);
        emit PassportDisputed(tokenId, msg.sender, reason);
    }

    /// @notice KarProPass holder resolves a dispute.
    function resolveDispute(uint256 tokenId, bool uphold) external nonReentrant {
        _requireExists(tokenId);
        if (!IKarProStaking(karProStakingAddress).isActiveVerifier(msg.sender)) revert NotActiveVerifier();
        Status current = passportStatus[tokenId];
        if (current != Status.DISPUTED) revert InvalidStatus(current);
        if (uphold) {
            passportStatus[tokenId] = Status.VERIFIED;
        } else {
            passportStatus[tokenId] = Status.UNVERIFIED;
            passportVerifier[tokenId] = address(0);
            passportVerifiedAt[tokenId] = 0;
        }
        emit DisputeResolved(tokenId, msg.sender, uphold);
    }

    /// @notice Owner appends a rich on-chain record.
    function appendRecord(
        uint256 tokenId,
        string calldata recordType,
        string calldata description,
        string calldata evidenceCID
    ) external nonReentrant {
        _requireExists(tokenId);
        if (msg.sender != ownerOf(tokenId)) revert NotOwner();
        if (bytes(recordType).length == 0) revert EmptyField("recordType");
        if (bytes(description).length == 0) revert EmptyField("description");
        _appendRecord(tokenId, recordType, description, evidenceCID, msg.sender);
    }

    /// @notice Permissionless discrepancy report.
    function reportDiscrepancy(uint256 tokenId, string calldata description, string calldata evidenceCID)
        external
        nonReentrant
    {
        _requireExists(tokenId);
        if (bytes(description).length == 0) revert EmptyField("description");
        _appendRecord(tokenId, "discrepancy", description, evidenceCID, msg.sender);
    }

    /// @notice KarProPass holder appends a public attestation.
    function appendAttestation(uint256 tokenId, string calldata description, string calldata evidenceCID)
        external
        nonReentrant
    {
        _requireExists(tokenId);
        if (!IKarProStaking(karProStakingAddress).isActiveVerifier(msg.sender)) revert NotActiveVerifier();
        if (bytes(description).length == 0) revert EmptyField("description");
        _appendRecord(tokenId, "attestation", description, evidenceCID, msg.sender);
    }

    /// @notice Returns verification state for a passport.
    function getPassportStatus(uint256 tokenId)
        external
        view
        returns (Status status, address verifier, uint256 verifiedAt)
    {
        _requireExists(tokenId);
        return (passportStatus[tokenId], passportVerifier[tokenId], passportVerifiedAt[tokenId]);
    }

    /// @notice Number of rich records for a token.
    function recordCount(uint256 tokenId) external view returns (uint256) {
        _requireExists(tokenId);
        return records[tokenId].length;
    }

    /// @notice Next token id to be minted.
    function nextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    /// @inheritdoc ERC721URIStorage
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _requireExists(uint256 tokenId) internal view {
        if (_ownerOf(tokenId) == address(0)) revert NonexistentToken();
    }

    function _appendRecord(
        uint256 tokenId,
        string memory recordType,
        string memory description,
        string memory evidenceCID,
        address author
    ) internal {
        records[tokenId].push(
            PassportRecord({
                timestamp: block.timestamp,
                author: author,
                recordType: recordType,
                description: description,
                evidenceCID: evidenceCID
            })
        );
        emit RecordAppended(tokenId, author, recordType, description, evidenceCID);
    }
}
