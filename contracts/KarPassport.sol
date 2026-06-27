// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Version policy:
//   PATCH (Z): bug fixes that do not change ABI or storage layout
//   MINOR (Y): new functions added, backward compatible
//   MAJOR (X): breaking ABI changes, storage layout changes,
//               or fundamental behavior change
//   Pre-release: -rc.N for release candidates, remove on mainnet deploy
//   Immutable contracts (KarPassport, KarProPass, KarProStaking):
//     any change = new deployment = bump MINOR or MAJOR
//   Upgradeable contracts (MarketplaceEscrow):
//     UUPS upgrade = bump MINOR or MAJOR depending on scope

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IKarProStaking {
    function isActiveVerifier(address a) external view returns (bool);
}

/// @title KarPassport
/// @notice ERC-721 vehicle passport with verification lifecycle, dispute deposits, and append-only records.
/// @dev v2: chain-scoped tokenId encoding, Ownable admin, payable dispute bonds.
/// @custom:version 1.2.0-rc.1
contract KarPassport is ERC721URIStorage, Ownable, ReentrancyGuard {
    string public constant VERSION = "1.2.0-rc.1";

    enum Status {
        UNVERIFIED,
        VERIFIED,
        DISPUTED
    }

    enum DisputeOutcome {
        ConfirmDispute,
        RejectDispute
    }

    struct PassportRecord {
        uint256 timestamp;
        address author;
        string recordType;
        string description;
        string evidenceCID;
    }

    address public immutable karProStakingAddress;
    uint256 public immutable tokenIdOffset;

    uint256 public disputeDeposit;
    uint256 public totalLockedDeposits;

    uint256 private _nextTokenId;

    mapping(uint256 => Status) public passportStatus;
    mapping(uint256 => address) public passportVerifier;
    mapping(uint256 => uint256) public passportVerifiedAt;
    mapping(uint256 => PassportRecord[]) public records;
    mapping(uint256 => uint256) public disputeDeposits;
    mapping(uint256 => address) public disputeOpenedBy;

    event PassportMinted(address indexed to, uint256 indexed tokenId, string uri);
    event PassportVerified(uint256 indexed tokenId, address indexed verifier);
    event PassportDisputed(uint256 indexed tokenId, address indexed disputer, string reason);
    event DisputeResolved(uint256 indexed tokenId, address indexed resolver, DisputeOutcome outcome);
    event DisputeWithdrawn(uint256 indexed tokenId, address indexed opener, uint256 amount);
    event DisputeDepositUpdated(uint256 previousAmount, uint256 newAmount);
    event DisputeDepositPaid(uint256 indexed tokenId, address indexed opener, uint256 amount);
    event EthRescued(address indexed to, uint256 amount);
    event PassportURIUpdated(uint256 indexed tokenId, string newURI, address indexed author);
    event VerificationReset(uint256 indexed tokenId, address indexed author);
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
    error SameURI();
    error InsufficientDeposit();
    error NotDisputeOpener();
    error NoActiveDispute();
    error CannotResolveSelfDispute();
    error NothingToRescue();
    error TransferFailed();
    error TokenIdSpaceExhausted();

    /// @notice Deploys KarPassport with chain-scoped tokenId offset and default dispute deposit.
    /// @param karProStakingAddress_ KarProStaking contract for verifier checks.
    /// @param initialOwner Owner for dispute deposit and ETH rescue parameters.
    /// @param disputeDeposit_ Initial dispute bond in wei (default 0.01 ether recommended).
    constructor(address karProStakingAddress_, address initialOwner, uint256 disputeDeposit_)
        ERC721("KarPassport", "KPPT")
        Ownable(initialOwner)
    {
        karProStakingAddress = karProStakingAddress_;
        tokenIdOffset = uint256(block.chainid) << 128;
        _nextTokenId = tokenIdOffset;
        disputeDeposit = disputeDeposit_;
    }

    /// @notice Chain id encoded in the high 128 bits of `tokenId`.
    function chainIdOf(uint256 tokenId) public pure returns (uint256) {
        return tokenId >> 128;
    }

    /// @notice Local mint sequence within the chain namespace.
    function localIdOf(uint256 tokenId) public pure returns (uint256) {
        return tokenId & type(uint128).max;
    }

    /// @notice Owner updates the minimum dispute deposit for new disputes.
    /// @param amount New minimum deposit in wei.
    /// @dev Setting amount to zero disables griefing protection.
    ///      Disputes can be opened at zero cost when deposit is 0.
    function setDisputeDeposit(uint256 amount) external onlyOwner {
        uint256 previous = disputeDeposit;
        disputeDeposit = amount;
        emit DisputeDepositUpdated(previous, amount);
    }

    /// @notice Withdraw ETH not locked in active dispute deposits.
    /// @param to Recipient of excess ETH.
    /// @param amount Amount to withdraw (must not exceed free balance).
    function rescueExcessEth(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert EmptyField("to");
        uint256 locked = totalLockedDeposits;
        uint256 balance = address(this).balance;
        if (amount == 0 || amount > balance - locked) revert NothingToRescue();
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit EthRescued(to, amount);
    }

    /// @notice Permissionless mint of a new KarPassport NFT.
    /// @param to Recipient address.
    /// @param uri Metadata URI (Arweave).
    /// @return tokenId Minted token id (chain-prefixed).
    /// @dev Reverts if this chain's tokenId namespace is exhausted (2^128 passports minted).
    function mintPassport(address to, string calldata uri)
        external
        nonReentrant
        returns (uint256 tokenId)
    {
        if (localIdOf(_nextTokenId) == type(uint128).max) revert TokenIdSpaceExhausted();
        tokenId = _nextTokenId++;
        passportStatus[tokenId] = Status.UNVERIFIED;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        emit PassportMinted(to, tokenId, uri);
    }

    /// @notice Owner updates metadata URI. VERIFIED edits reset verification; DISPUTED edits revert.
    function setPassportURI(uint256 tokenId, string calldata newURI) external nonReentrant {
        _requireExists(tokenId);
        if (msg.sender != ownerOf(tokenId)) revert NotOwner();
        if (bytes(newURI).length == 0) revert EmptyField("uri");

        Status current = passportStatus[tokenId];
        if (current == Status.DISPUTED) revert InvalidStatus(current);

        if (keccak256(bytes(newURI)) == keccak256(bytes(tokenURI(tokenId)))) {
            revert SameURI();
        }

        if (current == Status.VERIFIED) {
            passportStatus[tokenId] = Status.UNVERIFIED;
            passportVerifier[tokenId] = address(0);
            passportVerifiedAt[tokenId] = 0;
            emit VerificationReset(tokenId, msg.sender);
        }

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

    /// @notice Open a dispute on a VERIFIED passport with a refundable deposit.
    /// @param tokenId Passport token id.
    /// @param reason Human-readable dispute reason.
    function disputePassport(uint256 tokenId, string calldata reason) external payable nonReentrant {
        _requireExists(tokenId);
        Status current = passportStatus[tokenId];
        if (current != Status.VERIFIED) revert InvalidStatus(current);
        if (bytes(reason).length == 0) revert EmptyField("reason");
        if (msg.value < disputeDeposit) revert InsufficientDeposit();

        passportStatus[tokenId] = Status.DISPUTED;
        disputeDeposits[tokenId] = msg.value;
        disputeOpenedBy[tokenId] = msg.sender;
        totalLockedDeposits += msg.value;

        _appendRecord(tokenId, "discrepancy", reason, "", msg.sender);
        emit PassportDisputed(tokenId, msg.sender, reason);
        emit DisputeDepositPaid(tokenId, msg.sender, msg.value);
    }

    /// @notice Dispute opener withdraws dispute, restores VERIFIED, and receives full deposit refund.
    /// @param tokenId Passport token id.
    function withdrawDispute(uint256 tokenId) external nonReentrant {
        _requireExists(tokenId);
        if (passportStatus[tokenId] != Status.DISPUTED) revert NoActiveDispute();
        if (disputeOpenedBy[tokenId] != msg.sender) revert NotDisputeOpener();

        uint256 amount = disputeDeposits[tokenId];
        disputeDeposits[tokenId] = 0;
        totalLockedDeposits -= amount;

        passportStatus[tokenId] = Status.VERIFIED;

        _appendRecord(tokenId, "dispute_withdrawn", "Dispute withdrawn by opener", "", msg.sender);

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit DisputeWithdrawn(tokenId, msg.sender, amount);
    }

    /// @notice Active verifier resolves a dispute; deposit goes to disputer or resolver.
    /// @param tokenId Passport token id.
    /// @param outcome ConfirmDispute (verification wrong) or RejectDispute (verification stands).
    function resolveDispute(uint256 tokenId, DisputeOutcome outcome) external nonReentrant {
        _requireExists(tokenId);
        if (!IKarProStaking(karProStakingAddress).isActiveVerifier(msg.sender)) revert NotActiveVerifier();
        if (passportStatus[tokenId] != Status.DISPUTED) revert InvalidStatus(Status.DISPUTED);
        if (disputeOpenedBy[tokenId] == msg.sender) revert CannotResolveSelfDispute();

        address opener = disputeOpenedBy[tokenId];
        uint256 amount = disputeDeposits[tokenId];
        disputeDeposits[tokenId] = 0;
        if (amount > 0) {
            totalLockedDeposits -= amount;
        }

        address payee;
        if (outcome == DisputeOutcome.ConfirmDispute) {
            passportStatus[tokenId] = Status.UNVERIFIED;
            passportVerifier[tokenId] = address(0);
            passportVerifiedAt[tokenId] = 0;
            payee = opener;
        } else {
            passportStatus[tokenId] = Status.VERIFIED;
            payee = msg.sender;
        }

        if (amount > 0) {
            (bool ok,) = payable(payee).call{value: amount}("");
            if (!ok) revert TransferFailed();
        }

        emit DisputeResolved(tokenId, msg.sender, outcome);
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
