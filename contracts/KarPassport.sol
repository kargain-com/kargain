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
//   Amend-in-place: ship VERSION stays until it exists on a commercial chain

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ClaimablePayouts} from "./lib/ClaimablePayouts.sol";

interface IKarProStaking {
    function isActiveVerifier(address a) external view returns (bool);
}

/// @title KarPassport
/// @notice ERC-721 vehicle passport with verification lifecycle, dispute deposits, and append-only records.
/// @dev Dispute window, party exclusion, and bond-by-fault routing (SPEC §I.2 / §I.8). Claim-on-failure payouts;
///      gateway-bound bridge (SPEC §I.12). Storage layout ships only via Nuclear #2 redeploy.
/// @custom:version 1.6.0-rc.1
contract KarPassport is ERC721URIStorage, Ownable, ClaimablePayouts, ReentrancyGuard {
    string public constant VERSION = "1.6.0-rc.1";

    /// @notice Window after open during which opener may withdraw; afterwards only expire/resolve.
    uint256 public constant DISPUTE_WINDOW = 14 days;

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
    address public immutable platformRecipient;
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
    mapping(uint256 => uint256) public disputeOpenedAt;

    /// @notice One-time bound bridge gateway (set after deploy). Zero until `setBridgeGateway`.
    address public bridgeGateway;
    /// @notice Home-side custody lock while the passport is bridged away (gateway-only).
    mapping(uint256 => bool) public custodyLocked;

    event PassportMinted(address indexed to, uint256 indexed tokenId, string uri);
    event PassportVerified(uint256 indexed tokenId, address indexed verifier);
    event PassportDisputed(uint256 indexed tokenId, address indexed disputer, string reason);
    event DisputeResolved(uint256 indexed tokenId, address indexed resolver, DisputeOutcome outcome);
    event DisputeWithdrawn(uint256 indexed tokenId, address indexed opener, uint256 amount);
    event DisputeExpired(uint256 indexed tokenId, address indexed caller, uint256 amount);
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
    event CustodyLockSet(uint256 indexed tokenId, bool locked);
    event PassportBridgeMinted(address indexed to, uint256 indexed tokenId, string uri);
    event PassportBridgeBurned(uint256 indexed tokenId);
    event BridgeGatewaySet(address indexed gateway);

    error NonexistentToken();
    error NotOwner();
    error NotActiveVerifier();
    error CannotSelfVerify();
    error InvalidStatus(Status current);
    error EmptyField(string fieldName);
    error ZeroAddress();
    error ZeroDisputeDeposit();
    error SameURI();
    error InsufficientDeposit();
    error NotDisputeOpener();
    error NoActiveDispute();
    error CannotResolveOwnDispute();
    error DisputeWindowActive();
    error DisputeWindowElapsed();
    error NothingToRescue();
    error TokenIdSpaceExhausted();
    error GatewayAlreadySet();
    error NotBridgeGateway();
    error NotForeignToken();
    error NotHomeToken();
    error TokenExists();
    error PassportBridgedAway();

    modifier onlyGateway() {
        if (msg.sender != bridgeGateway) revert NotBridgeGateway();
        _;
    }

    /// @notice Deploys KarPassport with chain-scoped tokenId offset and default dispute deposit.
    /// @param karProStakingAddress_ KarProStaking contract for verifier checks.
    /// @param initialOwner Owner for dispute deposit and ETH rescue parameters.
    /// @param disputeDeposit_ Initial dispute bond in wei (must be non-zero; default 0.01 ether recommended).
    /// @param platformRecipient_ Immutable recipient for reject/expire bond routing (same as escrow fees).
    constructor(
        address karProStakingAddress_,
        address initialOwner,
        uint256 disputeDeposit_,
        address platformRecipient_
    ) ERC721("KarPassport", "KPPT") Ownable(initialOwner) {
        if (karProStakingAddress_ == address(0)) revert ZeroAddress();
        if (platformRecipient_ == address(0)) revert ZeroAddress();
        if (disputeDeposit_ == 0) revert ZeroDisputeDeposit();
        karProStakingAddress = karProStakingAddress_;
        platformRecipient = platformRecipient_;
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

    /// @notice One-time bind of the bridge gateway (owner-only). Reverts if already set or zero.
    /// @param gateway KarPassportBridgeGateway (or test mock) address.
    function setBridgeGateway(address gateway) external onlyOwner {
        if (bridgeGateway != address(0)) revert GatewayAlreadySet();
        if (gateway == address(0)) revert ZeroAddress();
        bridgeGateway = gateway;
        emit BridgeGatewaySet(gateway);
    }

    /// @notice Gateway sets or clears home-side custody lock while the passport is bridged away.
    /// @param tokenId Passport token id (must exist).
    /// @param locked True while locked at home; false on unlock.
    function setCustodyLock(uint256 tokenId, bool locked) external onlyGateway {
        if (chainIdOf(tokenId) != block.chainid) revert NotHomeToken();
        _requireExists(tokenId);
        custodyLocked[tokenId] = locked;
        emit CustodyLockSet(tokenId, locked);
    }

    /// @notice Gateway mints a foreign-origin representation on this chain. Does not touch `_nextTokenId`.
    /// @param to Recipient of the representation.
    /// @param tokenId Globally unique id (`chainIdOf` must differ from this chain).
    /// @param uri Metadata URI carried with the bridge message.
    function bridgeMint(address to, uint256 tokenId, string calldata uri) external onlyGateway {
        if (chainIdOf(tokenId) == block.chainid) revert NotForeignToken();
        if (_ownerOf(tokenId) != address(0)) revert TokenExists();
        passportStatus[tokenId] = Status.UNVERIFIED;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        emit PassportBridgeMinted(to, tokenId, uri);
    }

    /// @notice Gateway burns a foreign-origin representation on this chain.
    /// @param tokenId Representation token id (`chainIdOf` must differ from this chain).
    /// @dev Leaves `records[tokenId]` intact (indexer already captured them).
    function bridgeBurn(uint256 tokenId) external onlyGateway {
        if (chainIdOf(tokenId) == block.chainid) revert NotForeignToken();
        _requireExists(tokenId);
        _burn(tokenId);
        passportStatus[tokenId] = Status.UNVERIFIED;
        passportVerifier[tokenId] = address(0);
        passportVerifiedAt[tokenId] = 0;
        emit PassportBridgeBurned(tokenId);
    }

    /// @notice Gateway home-side return credit: reset trust and optionally adopt returned URI.
    /// @param tokenId Home-chain passport (must exist).
    /// @param uri Returned metadata URI; empty or identical skips URI update.
    function bridgeResetOnUnlock(uint256 tokenId, string calldata uri) external onlyGateway {
        if (chainIdOf(tokenId) != block.chainid) revert NotHomeToken();
        _requireExists(tokenId);
        passportStatus[tokenId] = Status.UNVERIFIED;
        passportVerifier[tokenId] = address(0);
        passportVerifiedAt[tokenId] = 0;
        emit VerificationReset(tokenId, bridgeGateway);

        if (bytes(uri).length > 0) {
            if (keccak256(bytes(uri)) != keccak256(bytes(tokenURI(tokenId)))) {
                _setTokenURI(tokenId, uri);
                emit PassportURIUpdated(tokenId, uri, bridgeGateway);
            }
        }

        custodyLocked[tokenId] = false;
        emit CustodyLockSet(tokenId, false);
    }

    /// @notice Owner updates the minimum dispute deposit for new disputes.
    /// @param disputeDeposit_ New minimum deposit in wei (must be non-zero).
    /// @dev Zero is rejected categorically so the deterrent cannot be switched off by value.
    ///      Magnitude has no on-chain ceiling; Timelock48h visibility controls overpricing.
    function setDisputeDeposit(uint256 disputeDeposit_) external onlyOwner {
        if (disputeDeposit_ == 0) revert ZeroDisputeDeposit();
        uint256 previous = disputeDeposit;
        disputeDeposit = disputeDeposit_;
        emit DisputeDepositUpdated(previous, disputeDeposit_);
    }

    /// @notice Withdraw ETH not locked in active dispute deposits or outstanding claims.
    /// @param to Recipient of excess ETH.
    /// @param amount Amount to withdraw (must not exceed free balance).
    function rescueExcessEth(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 locked = totalLockedDeposits + totalPendingNative();
        uint256 balance = address(this).balance;
        if (amount == 0 || amount > balance - locked) revert NothingToRescue();
        _payNative(to, amount);
        emit EthRescued(to, amount);
    }

    /// @notice Withdraw a pending native (`asset == address(0)`) claim credited after a failed push.
    function withdrawClaim(address asset) external nonReentrant {
        _withdrawClaim(asset);
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
        _requireNotBridgedAway(tokenId);
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
        _requireNotBridgedAway(tokenId);
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
        _requireNotBridgedAway(tokenId);
        Status current = passportStatus[tokenId];
        if (current != Status.VERIFIED) revert InvalidStatus(current);
        if (bytes(reason).length == 0) revert EmptyField("reason");
        if (msg.value < disputeDeposit) revert InsufficientDeposit();

        passportStatus[tokenId] = Status.DISPUTED;
        disputeDeposits[tokenId] = msg.value;
        disputeOpenedBy[tokenId] = msg.sender;
        disputeOpenedAt[tokenId] = block.timestamp;
        totalLockedDeposits += msg.value;

        _appendRecord(tokenId, "discrepancy", reason, "", msg.sender);
        emit PassportDisputed(tokenId, msg.sender, reason);
        emit DisputeDepositPaid(tokenId, msg.sender, msg.value);
    }

    /// @notice Dispute opener withdraws before the window ends: restores VERIFIED, full deposit refund.
    /// @param tokenId Passport token id.
    function withdrawDispute(uint256 tokenId) external nonReentrant {
        _requireExists(tokenId);
        _requireNotBridgedAway(tokenId);
        if (passportStatus[tokenId] != Status.DISPUTED) revert NoActiveDispute();
        if (disputeOpenedBy[tokenId] != msg.sender) revert NotDisputeOpener();
        if (block.timestamp >= disputeOpenedAt[tokenId] + DISPUTE_WINDOW) revert DisputeWindowElapsed();

        uint256 amount = _clearDisputeAccounting(tokenId);

        passportStatus[tokenId] = Status.VERIFIED;

        _appendRecord(tokenId, "dispute_withdrawn", "Dispute withdrawn by opener", "", msg.sender);

        _payNative(msg.sender, amount);

        emit DisputeWithdrawn(tokenId, msg.sender, amount);
    }

    /// @notice Active verifier resolves a dispute; bond routes by fault (never to the resolver).
    /// @param tokenId Passport token id.
    /// @param outcome ConfirmDispute (assertion wrong → UNVERIFIED, bond → opener) or RejectDispute (stands, bond → platform).
    /// @dev Excludes opener, passport owner, and recorded passportVerifier. A later hired independent verifier may resolve.
    function resolveDispute(uint256 tokenId, DisputeOutcome outcome) external nonReentrant {
        _requireExists(tokenId);
        _requireNotBridgedAway(tokenId);
        if (!IKarProStaking(karProStakingAddress).isActiveVerifier(msg.sender)) revert NotActiveVerifier();
        if (passportStatus[tokenId] != Status.DISPUTED) revert NoActiveDispute();

        address opener = disputeOpenedBy[tokenId];
        address challenged = passportVerifier[tokenId];
        if (msg.sender == opener || msg.sender == ownerOf(tokenId) || msg.sender == challenged) {
            revert CannotResolveOwnDispute();
        }

        uint256 amount = _clearDisputeAccounting(tokenId);

        if (outcome == DisputeOutcome.ConfirmDispute) {
            passportStatus[tokenId] = Status.UNVERIFIED;
            passportVerifier[tokenId] = address(0);
            passportVerifiedAt[tokenId] = 0;
            if (amount > 0) {
                _payNative(opener, amount);
            }
        } else {
            passportStatus[tokenId] = Status.VERIFIED;
            if (amount > 0) {
                _payNative(platformRecipient, amount);
            }
        }

        emit DisputeResolved(tokenId, msg.sender, outcome);
    }

    /// @notice Permissionless conclusion after the dispute window: assertion lapses to UNVERIFIED; bond → platform.
    /// @param tokenId Passport token id.
    function expireDispute(uint256 tokenId) external nonReentrant {
        _requireExists(tokenId);
        _requireNotBridgedAway(tokenId);
        if (passportStatus[tokenId] != Status.DISPUTED) revert NoActiveDispute();
        if (block.timestamp < disputeOpenedAt[tokenId] + DISPUTE_WINDOW) revert DisputeWindowActive();

        uint256 amount = _clearDisputeAccounting(tokenId);

        passportStatus[tokenId] = Status.UNVERIFIED;
        passportVerifier[tokenId] = address(0);
        passportVerifiedAt[tokenId] = 0;

        if (amount > 0) {
            _payNative(platformRecipient, amount);
        }

        emit DisputeExpired(tokenId, msg.sender, amount);
    }

    /// @notice Owner appends a rich on-chain record.
    function appendRecord(
        uint256 tokenId,
        string calldata recordType,
        string calldata description,
        string calldata evidenceCID
    ) external nonReentrant {
        _requireExists(tokenId);
        _requireNotBridgedAway(tokenId);
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
        _requireNotBridgedAway(tokenId);
        if (bytes(description).length == 0) revert EmptyField("description");
        _appendRecord(tokenId, "discrepancy", description, evidenceCID, msg.sender);
    }

    /// @notice KarProPass holder appends a public attestation.
    function appendAttestation(uint256 tokenId, string calldata description, string calldata evidenceCID)
        external
        nonReentrant
    {
        _requireExists(tokenId);
        _requireNotBridgedAway(tokenId);
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

    function _requireNotBridgedAway(uint256 tokenId) internal view {
        if (custodyLocked[tokenId]) revert PassportBridgedAway();
    }

    /// @dev Clears deposit, opener, and openedAt; unlocks accounting. Returns locked amount.
    function _clearDisputeAccounting(uint256 tokenId) internal returns (uint256 amount) {
        amount = disputeDeposits[tokenId];
        disputeDeposits[tokenId] = 0;
        disputeOpenedBy[tokenId] = address(0);
        disputeOpenedAt[tokenId] = 0;
        if (amount > 0) {
            totalLockedDeposits -= amount;
        }
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
