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
//   Upgradeable contracts (FixedPriceConsignment, AscendingConsignment):
//     UUPS upgrade = bump MINOR or MAJOR depending on scope
//   Amend-in-place: ship VERSION stays until it exists on a commercial chain

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IEncumbranceSource} from "./interfaces/IEncumbranceSource.sol";
import {IKarPassportEncumbrance} from "./interfaces/IKarPassportEncumbrance.sol";
import {BondedChallenge} from "./lib/BondedChallenge.sol";

interface IKarProStaking {
    function isActiveVerifier(address a) external view returns (bool);
}

/// @title KarPassport
/// @notice ERC-721 vehicle passport with verification, BondedChallenge verification challenges,
///         encumbrance permission (`may`), and append-only records.
/// @dev Verification challenge state machine lives in BondedChallenge. This contract supplies
///      eligibility, exclusion, qualification, bond amount, and domain terminals (lapse/stand).
///      Spec: commerce-model §7.2, §9, §13a.1, §13a.4. Nuclear #2 redeploy for live cutover.
/// @custom:version 1.8.0-rc.1
contract KarPassport is ERC721URIStorage, Ownable, BondedChallenge, IKarPassportEncumbrance {
    string public constant VERSION = "1.8.0-rc.1";

    /// @notice Window captured into each verification challenge at open (library immutable).
    uint256 public constant DISPUTE_WINDOW = 14 days;
    uint256 public constant MAX_ENCUMBRANCE_SOURCES = 8;

    /// @notice Gas stipend for each registered source `may` probe (E6).
    /// @dev Sized for a correct source with dozens of SLOADs; stops a buggy infinite loop
    ///      without letting silence become permission. Registration is governed — not an
    ///      anti-grief bound against a hostile registrant.
    uint256 public constant SOURCE_MAY_GAS = 100_000;

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
    address public immutable platformRecipient;
    uint256 public immutable tokenIdOffset;

    /// @notice Governance bond amount for the next verification challenge open (exact match).
    uint256 public disputeDeposit;

    uint256 private _nextTokenId;

    mapping(uint256 => Status) public passportStatus;
    mapping(uint256 => address) public passportVerifier;
    mapping(uint256 => uint256) public passportVerifiedAt;
    mapping(uint256 => PassportRecord[]) public records;

    /// @notice One-time bound bridge gateway (set after deploy). Zero until `setBridgeGateway`.
    address public bridgeGateway;
    /// @notice Home-side custody lock while the passport is bridged away (gateway-only).
    mapping(uint256 => bool) public custodyLocked;

    /// @dev Governed external encumbrance sources (E4). Passport is intrinsic for its own challenge (E5).
    address[] private _encumbranceSources;
    /// @dev 1-based index into `_encumbranceSources`; 0 = not registered.
    mapping(address => uint256) private _encumbranceSourceIndex;

    event PassportMinted(address indexed to, uint256 indexed tokenId, string uri);
    event PassportVerified(uint256 indexed tokenId, address indexed verifier);
    event PassportDisputed(uint256 indexed tokenId, address indexed disputer);
    /// @notice Verification lapsed after an upheld or expired challenge (domain outcome).
    event VerificationLapsed(uint256 indexed tokenId);
    /// @notice Verification stood after a rejected or withdrawn challenge (domain outcome).
    event VerificationStood(uint256 indexed tokenId);
    event DisputeDepositUpdated(uint256 previousAmount, uint256 newAmount);
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
    event EncumbranceSourceAdded(address indexed source);
    event EncumbranceSourceRemoved(address indexed source);

    error NonexistentToken();
    error NotOwner();
    error NotActiveVerifier();
    error CannotSelfVerify();
    error InvalidStatus(Status current);
    error EmptyField(string fieldName);
    error ZeroAddress();
    error ZeroDisputeDeposit();
    error SameURI();
    error NothingToRescue();
    error TokenIdSpaceExhausted();
    error GatewayAlreadySet();
    error NotBridgeGateway();
    error NotForeignToken();
    error NotHomeToken();
    error TokenExists();
    error PassportBridgedAway();
    error SourceAlreadyRegistered();
    error SourceNotRegistered();
    error TooManyEncumbranceSources();
    /// @notice Registered source reverted, returned nothing, returned unreadable data, or exhausted its gas stipend (E6).
    error SourceUnanswerable(address source);

    modifier onlyGateway() {
        if (msg.sender != bridgeGateway) revert NotBridgeGateway();
        _;
    }

    /// @notice Deploys KarPassport with chain-scoped tokenId offset and challenge bond.
    /// @param karProStakingAddress_ KarProStaking contract for verifier / judge checks.
    /// @param initialOwner Owner for bond, registry, and ETH rescue parameters.
    /// @param disputeDeposit_ Initial challenge bond in wei (must be non-zero).
    /// @param platformRecipient_ Forfeit recipient (reject/expire bonds); also configures BondedChallenge.
    constructor(
        address karProStakingAddress_,
        address initialOwner,
        uint256 disputeDeposit_,
        address platformRecipient_
    ) ERC721("KarPassport", "KPPT") Ownable(initialOwner) {
        if (karProStakingAddress_ == address(0)) revert ZeroAddress();
        if (platformRecipient_ == address(0)) revert ZeroAddress();
        if (disputeDeposit_ == 0) revert ZeroDisputeDeposit();
        _configureBondedChallenge(platformRecipient_, DISPUTE_WINDOW);
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

    /// @inheritdoc IKarPassportEncumbrance
    /// @dev External sources are probed under `SOURCE_MAY_GAS`. Unanswerable → `SourceUnanswerable`
    ///      (E6). Explicit `false` from a readable answer still returns `false`.
    function may(uint256 tokenId, Intent intent) external view override returns (bool) {
        _requireExists(tokenId);

        // Readiness (§9).
        if (intent == Intent.OpenConsignment) {
            if (passportStatus[tokenId] != Status.VERIFIED) return false;
        }
        // LeaveChain: always ready (unverified may travel).

        // Intrinsic verification challenge forbids both intents (E5 — no self-registry entry).
        if (_isChallengeActive(tokenId)) return false;

        // External sources (E1/E4/E6). Intent enum values match IEncumbranceSource.
        // Unanswerable source → named refuse (never treat silence as permission).
        IEncumbranceSource.Intent srcIntent = IEncumbranceSource.Intent(uint8(intent));
        uint256 n = _encumbranceSources.length;
        for (uint256 i = 0; i < n; ) {
            address source = _encumbranceSources[i];
            (bool success, bytes memory data) = source.staticcall{gas: SOURCE_MAY_GAS}(
                abi.encodeWithSelector(IEncumbranceSource.may.selector, tokenId, srcIntent)
            );
            if (!success || data.length != 32) revert SourceUnanswerable(source);
            if (!abi.decode(data, (bool))) return false;
            unchecked {
                ++i;
            }
        }
        return true;
    }

    /// @notice Governed registration of an external encumbrance source (E4).
    function addEncumbranceSource(address source) external onlyOwner {
        if (source == address(0)) revert ZeroAddress();
        if (_encumbranceSources.length >= MAX_ENCUMBRANCE_SOURCES) revert TooManyEncumbranceSources();
        if (_encumbranceSourceIndex[source] != 0) revert SourceAlreadyRegistered();
        _encumbranceSources.push(source);
        _encumbranceSourceIndex[source] = _encumbranceSources.length; // 1-based
        emit EncumbranceSourceAdded(source);
    }

    /// @notice Remove a registered source. Outstanding obligations on that source stop counting (E4).
    function removeEncumbranceSource(address source) external onlyOwner {
        uint256 index1 = _encumbranceSourceIndex[source];
        if (index1 == 0) revert SourceNotRegistered();
        uint256 index0 = index1 - 1;
        uint256 last = _encumbranceSources.length - 1;
        if (index0 != last) {
            address moved = _encumbranceSources[last];
            _encumbranceSources[index0] = moved;
            _encumbranceSourceIndex[moved] = index1;
        }
        _encumbranceSources.pop();
        delete _encumbranceSourceIndex[source];
        emit EncumbranceSourceRemoved(source);
    }

    function encumbranceSourceCount() external view returns (uint256) {
        return _encumbranceSources.length;
    }

    function encumbranceSourceAt(uint256 index) external view returns (address) {
        return _encumbranceSources[index];
    }

    function isEncumbranceSource(address source) external view returns (bool) {
        return _encumbranceSourceIndex[source] != 0;
    }

    /// @notice One-time bind of the bridge gateway (owner-only). Reverts if already set or zero.
    function setBridgeGateway(address gateway) external onlyOwner {
        if (bridgeGateway != address(0)) revert GatewayAlreadySet();
        if (gateway == address(0)) revert ZeroAddress();
        bridgeGateway = gateway;
        emit BridgeGatewaySet(gateway);
    }

    /// @notice Gateway sets or clears home-side custody lock while the passport is bridged away.
    function setCustodyLock(uint256 tokenId, bool locked) external onlyGateway {
        if (chainIdOf(tokenId) != block.chainid) revert NotHomeToken();
        _requireExists(tokenId);
        custodyLocked[tokenId] = locked;
        emit CustodyLockSet(tokenId, locked);
    }

    /// @notice Gateway mints a foreign-origin representation on this chain.
    function bridgeMint(address to, uint256 tokenId, string calldata uri) external onlyGateway {
        if (chainIdOf(tokenId) == block.chainid) revert NotForeignToken();
        if (_ownerOf(tokenId) != address(0)) revert TokenExists();
        passportStatus[tokenId] = Status.UNVERIFIED;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        emit PassportBridgeMinted(to, tokenId, uri);
    }

    /// @notice Gateway burns a foreign-origin representation on this chain.
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

    /// @notice Owner updates the challenge bond for new opens (exact match; captured at open).
    function setDisputeDeposit(uint256 disputeDeposit_) external onlyOwner {
        if (disputeDeposit_ == 0) revert ZeroDisputeDeposit();
        uint256 previous = disputeDeposit;
        disputeDeposit = disputeDeposit_;
        emit DisputeDepositUpdated(previous, disputeDeposit_);
    }

    /// @notice Withdraw ETH not locked in active challenge bonds or outstanding claims.
    function rescueExcessEth(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 locked = totalLockedBonds + totalPendingNative();
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

    /// @notice Open a verification challenge (BondedChallenge). Exact bond; anyone eligible (§7.2).
    function open(uint256 tokenId) public payable override nonReentrant {
        _requireExists(tokenId);
        Status current = passportStatus[tokenId];
        if (current != Status.VERIFIED) revert InvalidStatus(current);

        _openChallenge(tokenId, msg.sender, msg.value);
        passportStatus[tokenId] = Status.DISPUTED;

        emit PassportDisputed(tokenId, msg.sender);
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

    // ---- BondedChallenge instance hooks ----

    function _requiredBondAmount() internal view override returns (uint256) {
        return disputeDeposit;
    }

    function _requireChallengeActionAllowed(uint256 tokenId) internal view override {
        _requireNotBridgedAway(tokenId);
    }

    function isEligibleChallenger(uint256, address) internal pure override returns (bool) {
        return true;
    }

    function isQualifiedJudge(uint256, address judge) internal view override returns (bool) {
        return IKarProStaking(karProStakingAddress).isActiveVerifier(judge);
    }

    function isExcludedJudge(uint256 tokenId, address challenger, address judge)
        internal
        view
        override
        returns (bool)
    {
        return judge == challenger || judge == ownerOf(tokenId) || judge == passportVerifier[tokenId];
    }

    function _onUpheld(
        uint256 tokenId,
        address /*challenger*/,
        address /*judgeCaller*/,
        address /*bondRecipient*/,
        uint256 /*openedAt*/,
        uint256 /*windowDuration*/,
        uint256 /*bondAmount_*/
    ) internal override {
        _lapseVerification(tokenId);
    }

    function _onRejected(
        uint256 tokenId,
        address /*challenger*/,
        address /*judgeCaller*/,
        address /*bondRecipient*/,
        uint256 /*openedAt*/,
        uint256 /*windowDuration*/,
        uint256 /*bondAmount_*/
    ) internal override {
        passportStatus[tokenId] = Status.VERIFIED;
        emit VerificationStood(tokenId);
    }

    function _onExpired(
        uint256 tokenId,
        address /*challenger*/,
        address /*bondRecipient*/,
        uint256 /*openedAt*/,
        uint256 /*windowDuration*/,
        uint256 /*bondAmount_*/
    ) internal override {
        _lapseVerification(tokenId);
    }

    function _onWithdrawn(
        uint256 tokenId,
        address challenger,
        address /*bondRecipient*/,
        uint256 /*openedAt*/,
        uint256 /*windowDuration*/,
        uint256 /*bondAmount_*/
    ) internal override {
        passportStatus[tokenId] = Status.VERIFIED;
        _appendRecord(tokenId, "dispute_withdrawn", "Challenge withdrawn by opener", "", challenger);
        emit VerificationStood(tokenId);
    }

    function _lapseVerification(uint256 tokenId) private {
        passportStatus[tokenId] = Status.UNVERIFIED;
        passportVerifier[tokenId] = address(0);
        passportVerifiedAt[tokenId] = 0;
        emit VerificationLapsed(tokenId);
    }

    function _requireExists(uint256 tokenId) internal view {
        if (_ownerOf(tokenId) == address(0)) revert NonexistentToken();
    }

    function _requireNotBridgedAway(uint256 tokenId) internal view {
        if (custodyLocked[tokenId]) revert PassportBridgedAway();
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
